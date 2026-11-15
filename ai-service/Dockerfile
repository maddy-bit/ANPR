FROM python:3.12-slim

# OpenCV and native packages need these at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd --system --create-home appuser && chown -R appuser /app \
    && mkdir -p /home/appuser/.EasyOCR && chown -R appuser /home/appuser/.EasyOCR
USER appuser

# EasyOCR stores detector/recognizer weights under ~/.EasyOCR. Mount a volume there
# (compose: easyocr_cache:/home/appuser/.EasyOCR) so bundled/manual weights persist
# across container restarts instead of re-downloading.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
