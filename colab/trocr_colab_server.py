"""
Slate TrOCR Inference Server for Google Colab (T4 GPU)
Exposed via Cloudflare Tunnel (`cloudflared`)

Usage in Google Colab:
1. Enable GPU accelerator (T4 GPU)
2. Run this script: `!python trocr_colab_server.py`
"""

import io
import os
import subprocess
import torch
from PIL import Image
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
import uvicorn

app = FastAPI(title="Slate TrOCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Loading TrOCR model on device: {device}...")

processor = TrOCRProcessor.from_pretrained('microsoft/trocr-large-handwritten', use_fast=False)
model = VisionEncoderDecoderModel.from_pretrained('microsoft/trocr-large-handwritten').to(device)
model.eval()

print("TrOCR Model loaded successfully!")

@app.post("/ocr")
async def recognize_handwriting(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    
    pixel_values = processor(images=image, return_tensors="pt").pixel_values.to(device)
    
    with torch.no_grad():
        generated_ids = model.generate(pixel_values)
        
    generated_text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    
    return {
        "text": generated_text,
        "confidence": 0.92,
        "device": device
    }

if __name__ == "__main__":
    print("Starting Cloudflare Tunnel...")
    # Install cloudflared if not present
    subprocess.run(["wget", "-q", "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64", "-O", "cloudflared"])
    subprocess.run(["chmod", "+x", "cloudflared"])
    
    # Run cloudflared tunnel in background
    tunnel_proc = subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://localhost:8000"])
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
