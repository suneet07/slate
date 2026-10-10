/**
 * Sends a handwritten stroke image crop blob to the Google Colab TrOCR Cloudflare Tunnel endpoint
 */
export async function recognizeHandwritingCrop(
  imageBlob: Blob,
  trocrUrl: string
): Promise<{ text: string; confidence: number }> {
  if (!trocrUrl) {
    throw new Error('TrOCR Server URL is missing. Please set the Cloudflare Tunnel URL in Settings (⚙).');
  }

  const endpoint = `${trocrUrl.replace(/\/$/, '')}/ocr`;
  const formData = new FormData();
  formData.append('file', imageBlob, 'crop.png');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`TrOCR OCR Request failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      confidence: data.confidence ?? 0.85
    };
  } catch (err: any) {
    if (err.message && (err.message.includes('fetch') || err.message.includes('ERR_NAME_NOT_RESOLVED') || err.name === 'TypeError')) {
      throw new Error(`TrOCR Server unreachable at "${trocrUrl}". Please update your Google Colab Cloudflare Tunnel URL in Settings (⚙).`);
    }
    throw err;
  }
}

export interface InkStrokeData {
  id: string;
  points: number[][];
}

export interface OcrClusterResult {
  strokeIds: string[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageCropDataUrl: string;
}

/**
 * Clusters nearby spatial ink strokes into full sentence/line groups and sends combined image crops to TrOCR
 */
export async function processClusteredInkOcr(
  inkStrokes: InkStrokeData[],
  trocrUrl: string,
  maxGapX: number = 180,
  maxGapY: number = 30
): Promise<OcrClusterResult[]> {
  if (inkStrokes.length === 0) return [];

  // 1. Calculate bounding box & center Y for each stroke
  const strokeBoxes = inkStrokes.map((s) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    s.points.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    return {
      id: s.id,
      points: s.points,
      minX,
      minY,
      maxX,
      maxY,
      centerY: (minY + maxY) / 2
    };
  });

  // 2. Union-Find spatial clustering
  const parent = strokeBoxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  };

  // Connect strokes that belong to the SAME horizontal line
  for (let i = 0; i < strokeBoxes.length; i++) {
    for (let j = i + 1; j < strokeBoxes.length; j++) {
      const a = strokeBoxes[i];
      const b = strokeBoxes[j];

      // Check horizontal proximity and Y-center line alignment
      const nearX = !(a.maxX + maxGapX < b.minX || b.maxX + maxGapX < a.minX);
      const sameHorizontalLine = Math.abs(a.centerY - b.centerY) <= maxGapY;

      if (nearX && sameHorizontalLine) {
        union(i, j);
      }
    }
  }

  // 3. Group strokes by cluster root
  const clustersMap: Record<number, typeof strokeBoxes> = {};
  strokeBoxes.forEach((box, i) => {
    const root = find(i);
    if (!clustersMap[root]) clustersMap[root] = [];
    clustersMap[root].push(box);
  });

  const results: OcrClusterResult[] = [];

  // 4. Render each cluster to an offscreen canvas and run TrOCR
  for (const cluster of Object.values(clustersMap)) {
    let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
    cluster.forEach((b) => {
      if (b.minX < cMinX) cMinX = b.minX;
      if (b.minY < cMinY) cMinY = b.minY;
      if (b.maxX > cMaxX) cMaxX = b.maxX;
      if (b.maxY > cMaxY) cMaxY = b.maxY;
    });

    const cropWidth = Math.max(140, cMaxX - cMinX + 50);
    const cropHeight = Math.max(70, cMaxY - cMinY + 50);

    const canvas = document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');

    // Sort strokes in cluster left-to-right for sentence continuity
    cluster.sort((a, b) => a.minX - b.minX);

    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cropWidth, cropHeight);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw all stroke paths belonging to this cluster
      cluster.forEach((stroke) => {
        ctx.beginPath();
        stroke.points.forEach(([x, y], idx) => {
          const px = x - cMinX + 25;
          const py = y - cMinY + 25;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      });
    }

    const imageCropDataUrl = canvas.toDataURL('image/png');

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b || new Blob()), 'image/png')
    );

    const ocrData = await recognizeHandwritingCrop(blob, trocrUrl);

    results.push({
      strokeIds: cluster.map((c) => c.id),
      text: ocrData.text || 'Handwritten Group',
      x: cMinX,
      y: cMinY,
      width: Math.max(160, cMaxX - cMinX + 40),
      height: Math.max(70, cMaxY - cMinY + 30),
      imageCropDataUrl
    });
  }

  return results;
}
