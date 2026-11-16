
FROM python:3.13-slim

WORKDIR /app

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip

# Install PyTorch CPU version
RUN pip install --no-cache-dir \
    torch==2.13.0+cpu \
    torchvision==0.28.0+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
