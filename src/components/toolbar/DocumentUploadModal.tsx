import React, { useState } from 'react';
import { X, Upload, FileText, Trash2, BookOpen, Loader2, Image as ImageIcon, Plus, ListTree, AlertTriangle, RefreshCw } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { ocrDocument } from '../../lib/rag/pictureOcr';
import { parseUploadedFile, TeacherDocument } from '../../lib/rag/pdfExtractor';
import { buildNoteTree } from '../../lib/rag/treeIndexer';
import { renderNoteTree } from '../../lib/rag/noteTree';
import { DocImage } from '../../lib/graph/types';

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentUploadModal: React.FC<DocumentUploadModalProps> = ({ isOpen, onClose }) => {
  const { uploadedDocs, addDocument, updateDocument, removeDocument, clearDocuments, addNode } = useBoardStore();
  const [isParsing, setIsParsing] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string>('');
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  if (!isOpen) return null;

  /**
   * Text extraction is only half of ingest. The index the AI navigates is built here, by
   * the selected model, and patched onto the document when it lands.
   */
  const indexDocument = async (doc: TeacherDocument) => {
    const { tree, headings } = await buildNoteTree(doc, (progress) => setIndexStatus(progress.message));
    updateDocument(doc.id, { tree, headings });
    return tree;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsParsing(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setIndexStatus(`Extracting text and diagrams from ${file.name}...`);
        const parsed = await parseUploadedFile(file);
        // Read the text inside pictures and image-only pages before indexing, so slides
        // built from screenshots are searchable and their diagrams are described by what
        // they show rather than where they sit.
        setIndexStatus(`Reading text inside pictures in ${file.name}...`);
        const ocr = await ocrDocument(parsed, (done, total) =>
          setIndexStatus(`Reading text inside pictures in ${file.name}... ${done}/${total}`)
        ).catch((err) => {
          console.warn('OCR pass failed; continuing without it:', err);
          return {};
        });
        const doc = { ...parsed, ...ocr };
        addDocument(doc);
        await indexDocument(doc);
      }
    } catch (err: any) {
      console.error('Failed to parse uploaded document:', err);
      alert(`Error parsing document: ${err.message}`);
    } finally {
      setIsParsing(false);
      setIndexStatus('');
      e.target.value = '';
    }
  };

  const handleReindex = async (doc: TeacherDocument) => {
    setReindexingId(doc.id);
    try {
      await indexDocument(doc);
    } catch (err: any) {
      console.error('Re-index failed:', err);
      alert(`Re-index failed: ${err.message}`);
    } finally {
      setReindexingId(null);
      setIndexStatus('');
    }
  };

  const handleAddDiagramToBoard = (img: DocImage) => {
    addNode({
      type: 'image',
      label: img.caption || `Diagram Page ${img.pageNumber}`,
      imageUrl: img.dataUrl,
      width: 280,
      height: 180
    });
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '580px',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '24px',
          color: '#f3f4f6',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen size={20} color="#10b981" />
            <span>Teacher Notes & Vectorless RAG</span>
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '13px', color: '#9ca3af', lineHeight: '1.4' }}>
          Upload PDF lecture notes, markdown files, or text documents. Slate extracts embedded diagrams and text. You or the AI can place diagrams directly onto presentation slides!
        </p>

        {/* Upload Dropzone */}
        <label
          style={{
            border: '2px dashed rgba(16, 185, 129, 0.4)',
            borderRadius: '12px',
            padding: '20px',
            textAlign: 'center',
            background: 'rgba(16, 185, 129, 0.05)',
            cursor: isParsing ? 'wait' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          <input
            type="file"
            accept=".pdf,.txt,.md"
            multiple
            onChange={handleFileUpload}
            disabled={isParsing}
            style={{ display: 'none' }}
          />

          {isParsing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981' }}>
              <Loader2 size={24} className="animate-spin" />
              <span style={{ fontSize: '14px', fontWeight: 600 }}>
                {indexStatus || 'Extracting Diagrams & Text from PDF...'}
              </span>
            </div>
          ) : (
            <>
              <Upload size={28} color="#10b981" />
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#e0e7ff' }}>
                Click to upload PDF / Text Lecture Notes
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                Extracts page diagrams & indexed reference text
              </div>
            </>
          )}
        </label>

        {/* Uploaded Documents List */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#e5e7eb' }}>
              Indexed Reference Documents ({uploadedDocs.length})
            </span>
            {uploadedDocs.length > 0 && (
              <button
                onClick={clearDocuments}
                style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', cursor: 'pointer' }}
              >
                Clear All
              </button>
            )}
          </div>

          {uploadedDocs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', background: '#0f1117', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', color: '#6b7280', fontSize: '13px' }}>
              No reference documents uploaded yet. Upload lecture notes to enable AI RAG context!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {uploadedDocs.map((doc) => {
                const totalChunks = doc.chunks.length;
                const totalImages = doc.images ? doc.images.length : 0;
                const isExpanded = expandedDocId === doc.id;

                return (
                  <div
                    key={doc.id}
                    style={{
                      background: '#0f1117',
                      borderRadius: '8px',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileText size={18} color="#10b981" />
                        <div>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>{doc.filename}</span>
                          <span style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>
                            {doc.totalPages} page{doc.totalPages === 1 ? '' : 's'} • {totalChunks} text chunks • {totalImages} extracted diagram{totalImages === 1 ? '' : 's'}
                          </span>
                          {/* Index state is the difference between the AI navigating these
                              notes and keyword-guessing at them, so it is stated outright. */}
                          {reindexingId === doc.id ? (
                            <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Loader2 size={11} className="animate-spin" /> {indexStatus || 'Indexing...'}
                            </span>
                          ) : doc.tree && !doc.tree.degraded ? (
                            <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <ListTree size={11} /> Indexed by {doc.tree.model}
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#e0a137', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <AlertTriangle size={11} />
                              {doc.tree ? 'Index degraded — AI cannot navigate this well' : 'Not indexed — keyword search only'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                          style={{
                            background: 'rgba(255,255,255,0.08)',
                            border: 'none',
                            color: '#93c5fd',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '11px',
                            cursor: 'pointer'
                          }}
                        >
                          {isExpanded ? 'Hide Details' : 'View Details & Diagrams'}
                        </button>
                        <button
                          onClick={() => handleReindex(doc)}
                          disabled={reindexingId !== null || isParsing}
                          title="Rebuild the AI note index for this document"
                          style={{
                            background: 'rgba(255,255,255,0.08)',
                            border: 'none',
                            color: '#10b981',
                            borderRadius: '4px',
                            padding: '4px 6px',
                            cursor: reindexingId !== null ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <RefreshCw size={14} className={reindexingId === doc.id ? 'animate-spin' : undefined} />
                        </button>
                        <button
                          onClick={() => removeDocument(doc.id)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Chunk & Diagrams List */}
                    {isExpanded && (
                      <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* The note tree, exactly as the AI receives it. If a lookup went
                            wrong, this is where the reason is visible. */}
                        {doc.tree && doc.tree.nodes.length > 0 && (
                          <div>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                              <ListTree size={14} /> AI Note Index
                            </span>
                            <pre
                              style={{
                                background: '#161822',
                                padding: '8px 10px',
                                borderRadius: '4px',
                                fontSize: '10.5px',
                                lineHeight: '1.5',
                                color: '#d1d5db',
                                maxHeight: '200px',
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'var(--s-font-mono)',
                                margin: 0
                              }}
                            >
                              {renderNoteTree(doc.tree)}
                            </pre>
                          </div>
                        )}

                        {/* Diagrams Grid */}
                        {doc.images && doc.images.length > 0 && (
                          <div>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                              <ImageIcon size={14} /> Extracted PDF Diagrams ({doc.images.length})
                            </span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                              {doc.images.map((img) => (
                                <div key={img.id} style={{ background: '#161822', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
                                  <img src={img.dataUrl} alt={img.caption} style={{ width: '100%', height: '100px', objectFit: 'contain', background: '#ffffff' }} />
                                  <div style={{ padding: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f1117' }}>
                                    <span style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                                      Page {img.pageNumber} Diagram
                                    </span>
                                    <button
                                      onClick={() => handleAddDiagramToBoard(img)}
                                      title="Place Diagram onto Active Slide"
                                      style={{
                                        background: '#10b981',
                                        border: 'none',
                                        color: '#ffffff',
                                        borderRadius: '4px',
                                        padding: '2px 6px',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '2px'
                                      }}
                                    >
                                      <Plus size={12} /> Add to Slide
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Text Chunks */}
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#93c5fd', display: 'block', marginBottom: '6px' }}>
                            Indexed Text Chunks ({doc.chunks.length})
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                            {doc.chunks.map((chunk, idx) => (
                              <div key={chunk.id} style={{ background: '#161822', padding: '6px 10px', borderRadius: '4px', fontSize: '11px', color: '#d1d5db', lineHeight: '1.4' }}>
                                <span style={{ color: '#10b981', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                                  Chunk #{idx + 1} (Page {chunk.pageNumber}):
                                </span>
                                "{chunk.text}"
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
