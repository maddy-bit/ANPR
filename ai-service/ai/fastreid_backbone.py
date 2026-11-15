"""
FastReID Stronger Baseline (SBS) ResNet-50-IBN Architecture Implementation.

Implements the exact neural architecture serialized in `veri_sbs_R50-ibn.pth`:
1. ResNet-50 backbone with Instance-Batch Normalization (IBN-a) on stages 1-3.
2. FastReID compact Non-Local (NL) attention blocks on stage 2 (2 blocks) and stage 3 (3 blocks).
3. Last stride = 1 in stage 4 (retaining 16x16 spatial feature resolution).
4. Generalized Mean (GeM) Pooling with learnable power parameter p (p = 1.9932).
5. FastReID BNNeck feature bottleneck (BatchNorm2d on 2048-dim embedding).
6. Pixel normalization with ImageNet mean/std scaled to [0, 255].
7. Full 418/418 state_dict tensor compatibility with strict=True loading.
"""

from __future__ import annotations

import logging
from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

logger = logging.getLogger(__name__)


class IBN(nn.Module):
    """
    Instance-Batch Normalization (IBN-a) layer.
    Splits input channels in half:
    - First half normalized via InstanceNorm2d (invariance to contrast/illumination).
    - Second half normalized via BatchNorm2d (preserves identity/discriminative features).
    """

    def __init__(self, planes: int):
        super().__init__()
        half1 = int(planes / 2)
        self.half_planes = half1
        half2 = planes - half1
        self.IN = nn.InstanceNorm2d(half1, affine=True)
        self.BN = nn.BatchNorm2d(half2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        split = torch.split(x, self.half_planes, dim=1)
        out1 = self.IN(split[0].contiguous())
        out2 = self.BN(split[1].contiguous())
        return torch.cat((out1, out2), dim=1)


class Bottleneck(nn.Module):
    """
    ResNet Bottleneck block with optional IBN-a on the 1x1 conv layer.
    """

    expansion: int = 4

    def __init__(
        self,
        inplanes: int,
        planes: int,
        stride: int = 1,
        downsample: nn.Module | None = None,
        with_ibn: bool = False,
    ):
        super().__init__()
        self.conv1 = nn.Conv2d(inplanes, planes, kernel_size=1, bias=False)
        self.bn1 = IBN(planes) if with_ibn else nn.BatchNorm2d(planes)
        self.conv2 = nn.Conv2d(planes, planes, kernel_size=3, stride=stride, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(planes)
        self.conv3 = nn.Conv2d(planes, planes * self.expansion, kernel_size=1, bias=False)
        self.bn3 = nn.BatchNorm2d(planes * self.expansion)
        self.relu = nn.ReLU(inplace=True)
        self.downsample = downsample
        self.stride = stride

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = x

        out = self.conv1(x)
        out = self.bn1(out)
        out = self.relu(out)

        out = self.conv2(out)
        out = self.bn2(out)
        out = self.relu(out)

        out = self.conv3(out)
        out = self.bn3(out)

        if self.downsample is not None:
            identity = self.downsample(x)

        out += identity
        return self.relu(out)


class NonLocalBlock(nn.Module):
    """
    FastReID Non-Local Attention Block (embedded Gaussian formulation with inter_channels=1).
    Captures long-range spatial dependencies across the vehicle body.
    """

    def __init__(self, in_channels: int):
        super().__init__()
        self.in_channels = in_channels
        self.inter_channels = 1  # FastReID default: reduc_ratio // reduc_ratio = 1

        self.g = nn.Conv2d(
            in_channels=self.in_channels,
            out_channels=self.inter_channels,
            kernel_size=1,
            stride=1,
            padding=0,
        )

        self.W = nn.Sequential(
            nn.Conv2d(
                in_channels=self.inter_channels,
                out_channels=self.in_channels,
                kernel_size=1,
                stride=1,
                padding=0,
            ),
            nn.BatchNorm2d(self.in_channels),
        )

        self.theta = nn.Conv2d(
            in_channels=self.in_channels,
            out_channels=self.inter_channels,
            kernel_size=1,
            stride=1,
            padding=0,
        )

        self.phi = nn.Conv2d(
            in_channels=self.in_channels,
            out_channels=self.inter_channels,
            kernel_size=1,
            stride=1,
            padding=0,
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size = x.size(0)

        # (B, 1, H*W) -> (B, H*W, 1)
        g_x = self.g(x).view(batch_size, self.inter_channels, -1).permute(0, 2, 1)

        # (B, 1, H*W) -> (B, H*W, 1)
        theta_x = self.theta(x).view(batch_size, self.inter_channels, -1).permute(0, 2, 1)

        # (B, 1, H*W)
        phi_x = self.phi(x).view(batch_size, self.inter_channels, -1)

        # Affinity matrix (B, H*W, H*W)
        f = torch.matmul(theta_x, phi_x)
        f_div_c = f / float(f.size(-1))

        # Attended representation
        y = torch.matmul(f_div_c, g_x).permute(0, 2, 1).contiguous()
        y = y.view(batch_size, self.inter_channels, *x.size()[2:])

        # Residual projection
        z = self.W(y) + x
        return z


class ResNetIBNBackbone(nn.Module):
    """
    ResNet-50-IBN-a backbone with Non-Local attention blocks.
    - layer1: 3 blocks, IBN enabled.
    - layer2: 4 blocks, IBN enabled, NL_2 blocks inserted after block 2 and block 3.
    - layer3: 6 blocks, IBN enabled, NL_3 blocks inserted after block 3, block 4, and block 5.
    - layer4: 3 blocks, standard BN (no IBN), stride = 1 (last_stride=1).
    """

    def __init__(self, last_stride: int = 1):
        super().__init__()
        self.inplanes = 64
        self.conv1 = nn.Conv2d(3, 64, kernel_size=7, stride=2, padding=3, bias=False)
        self.bn1 = nn.BatchNorm2d(64)
        self.relu = nn.ReLU(inplace=True)
        self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, ceil_mode=True)

        self.layer1 = self._make_layer(64, 3, stride=1, with_ibn=True)
        self.layer2 = self._make_layer(128, 4, stride=2, with_ibn=True)
        self.layer3 = self._make_layer(256, 6, stride=2, with_ibn=True)
        self.layer4 = self._make_layer(512, 3, stride=last_stride, with_ibn=False)

        # Non-Local blocks: 2 in layer2 (indices [2, 3]), 3 in layer3 (indices [3, 4, 5])
        self.NL_2 = nn.ModuleList([NonLocalBlock(512) for _ in range(2)])
        self.NL_2_idx = [2, 3]

        self.NL_3 = nn.ModuleList([NonLocalBlock(1024) for _ in range(3)])
        self.NL_3_idx = [3, 4, 5]

    def _make_layer(
        self,
        planes: int,
        blocks: int,
        stride: int = 1,
        with_ibn: bool = False,
    ) -> nn.Sequential:
        downsample = None
        if stride != 1 or self.inplanes != planes * Bottleneck.expansion:
            downsample = nn.Sequential(
                nn.Conv2d(
                    self.inplanes,
                    planes * Bottleneck.expansion,
                    kernel_size=1,
                    stride=stride,
                    bias=False,
                ),
                nn.BatchNorm2d(planes * Bottleneck.expansion),
            )

        layers = [Bottleneck(self.inplanes, planes, stride, downsample, with_ibn=with_ibn)]
        self.inplanes = planes * Bottleneck.expansion
        for _ in range(1, blocks):
            layers.append(Bottleneck(self.inplanes, planes, with_ibn=with_ibn))

        return nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.conv1(x)
        x = self.bn1(x)
        x = self.relu(x)
        x = self.maxpool(x)

        x = self.layer1(x)

        nl2_counter = 0
        for i, block in enumerate(self.layer2):
            x = block(x)
            if i in self.NL_2_idx:
                x = self.NL_2[nl2_counter](x)
                nl2_counter += 1

        nl3_counter = 0
        for i, block in enumerate(self.layer3):
            x = block(x)
            if i in self.NL_3_idx:
                x = self.NL_3[nl3_counter](x)
                nl3_counter += 1

        x = self.layer4(x)
        return x


class GeMPooling(nn.Module):
    """
    Generalized Mean (GeM) Pooling with learnable power parameter p.
    f(x) = (1 / HW * sum(x^p))^(1/p)
    """

    def __init__(self, norm: float = 3.0, eps: float = 1e-6):
        super().__init__()
        self.p = nn.Parameter(torch.ones(1) * norm)
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Clamp to avoid NaN gradients and preserve strictly positive power inputs
        x_clamped = x.clamp(min=self.eps).pow(self.p)
        return F.adaptive_avg_pool2d(x_clamped, (1, 1)).pow(1.0 / self.p)


class FastReIdDummyBNNeck(nn.Module):
    """
    Preserves heads.bnneck.num_batches_tracked buffer for 100% strict checkpoint loading.
    """

    def __init__(self):
        super().__init__()
        self.register_buffer("num_batches_tracked", torch.tensor(0, dtype=torch.int64))


class FastReIdEmbeddingHeads(nn.Module):
    """
    FastReID SBS Embedding Heads:
    - pool_layer: GeneralizedMeanPoolingP
    - bottleneck: Sequential(BatchNorm2d(2048, eps=1e-5))
    - classifier: Linear(2048, 575, bias=False) (training only; loaded for strict=True compatibility)
    - bnneck: Dummy module holding num_batches_tracked buffer
    """

    def __init__(self, num_classes: int = 575):
        super().__init__()
        self.pool_layer = GeMPooling(norm=3.0)
        self.bottleneck = nn.Sequential(nn.BatchNorm2d(2048, eps=1e-5))
        self.classifier = nn.Linear(2048, num_classes, bias=False)
        self.bnneck = FastReIdDummyBNNeck()

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        pool_feat = self.pool_layer(features)
        neck_feat = self.bottleneck(pool_feat)
        # Squeeze spatial dimensions: (B, 2048, 1, 1) -> (B, 2048)
        return neck_feat.squeeze(-1).squeeze(-1)


class FastReIdSbsR50IbnModel(nn.Module):
    """
    Complete FastReID SBS ResNet-50-IBN Model for VeRi-776 Vehicle Re-Identification.
    Loads all 418 checkpoint tensors with strict=True.
    """
    pixel_mean: torch.Tensor
    pixel_std: torch.Tensor

    def __init__(self):
        super().__init__()
        # Normalization buffers matching checkpoint exactly
        self.register_buffer("pixel_mean", torch.zeros(1, 3, 1, 1))
        self.register_buffer("pixel_std", torch.ones(1, 3, 1, 1))

        self.backbone = ResNetIBNBackbone(last_stride=1)
        self.heads = FastReIdEmbeddingHeads(num_classes=575)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass for feature extraction.
        Input x: FloatTensor of shape (B, 3, 256, 256) in [0.0, 255.0] range, RGB order.
        Output: L2-normalized 2048-dimensional embedding tensor of shape (B, 2048).
        """
        # Normalize inside model using registered buffers
        x_norm = (x - self.pixel_mean) / self.pixel_std
        features = self.backbone(x_norm)
        neck_feat = self.heads(features)
        # Unit L2 normalization
        return F.normalize(neck_feat, p=2, dim=1)
