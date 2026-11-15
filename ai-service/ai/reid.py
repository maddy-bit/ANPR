"""
Vehicle Re-Identification Service using FastReID SBS ResNet-50-IBN (VeRi-776).

Extracts high-dimensional, fine-grained metric-learning feature embeddings (2048-dim)
from vehicle crops using a verified checkpoint fine-tuned on the VeRi-776 vehicle Re-ID dataset.

Guarantees:
1. Checkpoint SHA-256 verification before model loading.
2. Full 418/418 tensor loading with strict=True into genuine ResNet-50-IBN architecture.
3. 2048-dimensional float32 L2-normalized feature vectors.
4. Model provenance (name, version, dimension) persisted with every embedding.
5. Strict rejection of cross-model comparisons between incompatible embedding versions.
6. Explicit incompatibility reporting rather than silent fallback.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
import torch
import torchvision.transforms as transforms

from config import cfg
from ai.fastreid_backbone import FastReIdSbsR50IbnModel

logger = logging.getLogger(__name__)


def verify_checkpoint_hash(checkpoint_path: str | Path, expected_sha256: str) -> bool:
    """
    Verifies the SHA-256 hash of the checkpoint file before loading.
    Raises FileNotFoundError if file is missing.
    Raises ValueError if hash does not match expected_sha256.
    """
    path = Path(checkpoint_path)
    if not path.is_file():
        raise FileNotFoundError(f"Re-ID checkpoint file not found at: {path.resolve()}")

    sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            sha256.update(chunk)

    actual_hash = sha256.hexdigest().upper()
    expected_hash = expected_sha256.strip().upper()

    if actual_hash != expected_hash:
        raise ValueError(
            f"Re-ID checkpoint SHA-256 mismatch!\n"
            f"File: {path.resolve()}\n"
            f"Expected: {expected_hash}\n"
            f"Actual:   {actual_hash}\n"
            f"Checkpoint is invalid or corrupted. Refusing to load."
        )
    return True


class IncompatibleEmbeddingError(ValueError):
    """Raised when comparing ReId embeddings from different latent spaces or models."""
    pass


@dataclass
class EmbeddingComparisonOutcome:
    """
    Explicit structured outcome of embedding compatibility and similarity evaluation.
    """
    is_compatible: bool
    similarity: float | None
    reason: str | None = None


@dataclass
class ReIdEmbedding:
    """
    Vehicle Re-ID appearance embedding vector with full model provenance.
    """
    vector: np.ndarray  # float32 array, L2 normalized
    model_name: str = "fastreid_veri_sbs_r50_ibn"
    model_version: str = "veri-776-sbs-ibn-v2"
    dimension: int = 2048
    is_normalized: bool = True
    embedding_type: str = "fastreid"  # backwards compatibility field

    def to_list(self) -> list[float]:
        return self.vector.tolist()


class FastReIdExtractor:
    """
    Vehicle Re-ID feature extractor based on FastReID SBS ResNet-50-IBN checkpoint.
    Loads all 418 weights strictly and produces 2048-dimensional L2-normalized embeddings.
    """

    def __init__(
        self,
        weights_path: str | Path,
        expected_sha256: str,
        device: str = "cpu",
    ):
        self.device = torch.device(device)
        self.weights_path = Path(weights_path)
        self.expected_sha256 = expected_sha256

        # Step 1: Verify hash
        verify_checkpoint_hash(self.weights_path, self.expected_sha256)

        # Step 2: Instantiate genuine FastReID SBS ResNet-50-IBN architecture
        self.model = FastReIdSbsR50IbnModel()

        # Step 3: Load checkpoint state
        ckpt = torch.load(str(self.weights_path), map_location=self.device, weights_only=False)
        state_dict = ckpt.get("model", ckpt)

        # Step 4: Strict loading - fail explicitly on missing or unexpected tensors
        missing_keys, unexpected_keys = self.model.load_state_dict(state_dict, strict=True)
        if missing_keys or unexpected_keys:
            raise RuntimeError(
                f"FastReID checkpoint loading failed strict verification!\n"
                f"Missing keys: {missing_keys}\n"
                f"Unexpected keys: {unexpected_keys}"
            )

        self.model.to(self.device)
        self.model.eval()
        logger.info(
            f"Loaded FastReID SBS ResNet-50-IBN model ({len(state_dict)} tensors) strictly from {self.weights_path}"
        )

        # Step 5: FastReID evaluation preprocessing
        # 256x256, Bicubic interpolation, float in [0.0, 255.0]
        self.transform = transforms.Compose([
            transforms.ToPILImage(),
            transforms.Resize((256, 256), interpolation=transforms.InterpolationMode.BICUBIC),
        ])

    def extract(self, crop_bgr: np.ndarray) -> np.ndarray:
        """
        Extract a 2048-dimensional L2-normalized embedding vector from a BGR vehicle crop.
        """
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        pil_img = self.transform(rgb)

        # Convert PIL Image to float32 tensor in [0.0, 255.0] range (FastReID standard)
        np_img = np.array(pil_img, dtype=np.float32)  # (H, W, 3)
        tensor = torch.from_numpy(np_img).permute(2, 0, 1).unsqueeze(0).to(self.device)  # (1, 3, 256, 256)

        with torch.no_grad():
            feat = self.model(tensor).squeeze(0).cpu().numpy()

        # Verify finite values
        if not np.isfinite(feat).all():
            logger.error("Non-finite values detected in extracted Re-ID feature vector!")
            feat = np.nan_to_num(feat, nan=0.0, posinf=0.0, neginf=0.0)

        # Unit L2 normalization verification
        norm = np.linalg.norm(feat)
        if norm > 1e-6:
            feat = feat / norm
        else:
            feat = np.zeros_like(feat)

        return feat.astype(np.float32)

    def extract_batch(self, crops_bgr: List[np.ndarray]) -> np.ndarray:
        """
        Extract 2048-dimensional L2-normalized embeddings for a batch of BGR vehicle crops.
        """
        if not crops_bgr:
            return np.empty((0, 2048), dtype=np.float32)

        tensors = []
        for crop in crops_bgr:
            rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
            pil_img = self.transform(rgb)
            np_img = np.array(pil_img, dtype=np.float32)
            t = torch.from_numpy(np_img).permute(2, 0, 1)  # (3, 256, 256)
            tensors.append(t)

        batch_tensor = torch.stack(tensors).to(self.device)

        with torch.no_grad():
            feats = self.model(batch_tensor).cpu().numpy()

        # Verify finite values and normalize
        if not np.isfinite(feats).all():
            logger.error("Non-finite values detected in batch Re-ID feature vectors!")
            feats = np.nan_to_num(feats, nan=0.0, posinf=0.0, neginf=0.0)

        norms = np.linalg.norm(feats, axis=1, keepdims=True)
        norms = np.where(norms > 1e-6, norms, 1.0)
        feats = feats / norms

        return feats.astype(np.float32)


class ReIdService:
    """
    Production Vehicle Re-ID service.
    Defaults to verified FastReID SBS ResNet-50-IBN vehicle-specific model.
    """

    def __init__(
        self,
        model_path: Optional[str | Path] = None,
        expected_sha256: Optional[str] = None,
        device: Optional[str] = None,
        allow_fallback: bool = False,
    ):
        self.model_path = Path(model_path) if model_path else cfg.models.reid_model
        self.expected_sha256 = expected_sha256 or cfg.models.reid_expected_sha256
        self.allow_fallback = allow_fallback

        if device is None:
            self.device_str = "cuda" if (torch.cuda.is_available() and cfg.reid.use_gpu) else "cpu"
        else:
            self.device_str = device

        self.model_name = cfg.reid.model_name
        self.model_version = cfg.reid.model_version
        self.dimension = cfg.reid.embedding_dim

        self.extractor: Optional[FastReIdExtractor] = None
        self._init_extractor()

    def _init_extractor(self):
        try:
            self.extractor = FastReIdExtractor(
                weights_path=self.model_path,
                expected_sha256=self.expected_sha256,
                device=self.device_str,
            )
            logger.info(
                f"ReIdService initialized with model {self.model_name} (v{self.model_version}) on {self.device_str}"
            )
        except Exception as e:
            if not self.allow_fallback:
                logger.error(f"Failed to initialize FastReID model from {self.model_path}: {e}")
                raise
            else:
                logger.warning(f"ReIdService fallback enabled. Deep model unavailable: {e}")
                self.extractor = None

    def embed(self, vehicle_crop_bgr: Optional[np.ndarray]) -> Optional[ReIdEmbedding]:
        """
        Extract L2-normalized 2048-dim embedding vector for a vehicle crop.
        Returns ReIdEmbedding or None if crop is invalid.
        """
        if vehicle_crop_bgr is None or vehicle_crop_bgr.size == 0:
            return None

        h, w = vehicle_crop_bgr.shape[:2]
        if h < 20 or w < 20:
            return None

        if self.extractor is not None:
            feat = self.extractor.extract(vehicle_crop_bgr)
            return ReIdEmbedding(
                vector=feat,
                model_name=self.model_name,
                model_version=self.model_version,
                dimension=self.dimension,
                is_normalized=True,
                embedding_type="fastreid",
            )

        if self.allow_fallback:
            # Explicit fallback mode (only when explicitly requested)
            hsv = cv2.cvtColor(vehicle_crop_bgr, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1, 2], None, [16, 16, 8], [0, 180, 0, 256, 0, 256])
            vector = hist.flatten().astype(np.float32)
            norm = np.linalg.norm(vector)
            if norm > 1e-6:
                vector = vector / norm
            return ReIdEmbedding(
                vector=vector,
                model_name="hsv_histogram_fallback",
                model_version="legacy-v0",
                dimension=len(vector),
                is_normalized=True,
                embedding_type="hsv",
            )

        return None

    def compare(
        self,
        a: ReIdEmbedding | None,
        b: ReIdEmbedding | None,
    ) -> EmbeddingComparisonOutcome:
        """
        Compare two vehicle embeddings with explicit model compatibility validation.
        Returns explicit incompatibility outcome rather than silently disguising as zero similarity.
        """
        if a is None or b is None:
            return EmbeddingComparisonOutcome(
                is_compatible=False, similarity=None, reason="One or both embeddings are None."
            )
        if a.vector is None or b.vector is None or len(a.vector) == 0 or len(b.vector) == 0:
            return EmbeddingComparisonOutcome(
                is_compatible=False, similarity=None, reason="One or both embedding vectors are empty."
            )

        # Validate latent space compatibility
        if a.model_name != b.model_name:
            return EmbeddingComparisonOutcome(
                is_compatible=False,
                similarity=None,
                reason=f"Model name mismatch: '{a.model_name}' vs '{b.model_name}'. Incompatible latent spaces.",
            )
        if a.model_version != b.model_version:
            return EmbeddingComparisonOutcome(
                is_compatible=False,
                similarity=None,
                reason=f"Model version mismatch: '{a.model_version}' vs '{b.model_version}'. Incompatible latent spaces.",
            )
        if a.dimension != b.dimension or len(a.vector) != len(b.vector):
            return EmbeddingComparisonOutcome(
                is_compatible=False,
                similarity=None,
                reason=f"Embedding dimension mismatch: {a.dimension}d vs {b.dimension}d.",
            )

        # Cosine similarity for unit L2-normalized vectors is the dot product
        dot = float(np.dot(a.vector, b.vector))
        sim = max(0.0, min(1.0, dot))
        return EmbeddingComparisonOutcome(is_compatible=True, similarity=sim, reason=None)

    def similarity(
        self,
        a: ReIdEmbedding | None,
        b: ReIdEmbedding | None,
        strict: bool = False,
    ) -> float:
        """
        Compute cosine similarity between two vehicle embeddings.
        If strict=True, raises IncompatibleEmbeddingError on incompatible models.
        If strict=False, logs warning with explicit reason and returns 0.0 for backward compatibility.
        """
        outcome = self.compare(a, b)
        if not outcome.is_compatible:
            if strict:
                raise IncompatibleEmbeddingError(outcome.reason)
            logger.warning(f"Cross-model Re-ID comparison rejected: {outcome.reason}")
            return 0.0

        return outcome.similarity if outcome.similarity is not None else 0.0
