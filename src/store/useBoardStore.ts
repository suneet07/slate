import { needsOcr, ocrDocument } from '../lib/rag/pictureOcr';
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { SceneGraph, BoardNode, BoardEdge, InkStroke, ActiveTool, NodeColor, Slide } from '../lib/graph/types';
import { coordsToGridPos } from '../lib/graph/quantizer';
import { TeacherDocument } from '../lib/rag/pdfExtractor';
import {
  clearPersistedDocuments,
  loadPersistedDocuments,
  persistDocument,
  removePersistedDocument
} from '../lib/rag/docPersistence';
import { computeDynamicNodeDimensions } from '../lib/diff/layoutEngine';

/**
 * Routing knowledge for the retrieval step, editable in Settings.
 *
 * This is the cheap half of retrieval accuracy: telling the model where a kind of question
 * is answered costs a prompt edit, where teaching an embedding model the same thing costs a
 * fine-tune. Written for lecture notes; a teacher should rewrite it for their own subject.
 */
export const DEFAULT_EXPERT_RULES = `- Definitions, statements of a law, or "what is X" -> the section that first introduces X, not a later section that applies it.
- "Limitations", "deviations", "exceptions", "when does it fail" -> the subsection immediately AFTER the section stating the law or result.
- Derivations and proofs -> the section defining the quantities involved; the derivation usually directly follows the definition.
- Numerical problems, "solve", "calculate" -> worked examples in the same chapter as the relevant formula.
- A figure, graph, or circuit -> the section whose text discusses that figure, so the surrounding explanation comes with it.
- Comparisons ("X vs Y") -> both sections, one for each side.
- Units, constants, symbols -> the section that introduces the quantity, not a table of contents or appendix.`;

interface HistoryState {
  nodes: Record<string, BoardNode>;
  edges: Record<string, BoardEdge>;
  ink: Record<string, InkStroke>;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
  graphSnippet?: string;
  modelName?: string;
  imageCropUrl?: string;
  timestamp: string;
}

interface BoardStore {
  // Slides Deck State
  slides: Slide[];
  activeSlideId: string;
  
  // Active Slide Graph State
  nodes: Record<string, BoardNode>;
  edges: Record<string, BoardEdge>;
  ink: Record<string, InkStroke>;
  
  // UI & Tool State
  activeTool: ActiveTool;
  selectedIds: string[];
  connectingFromId: string | null;
  stageScale: number;
  stagePos: { x: number; y: number };
  activeColor: NodeColor;
  inkColor: string;
  isPresenting: boolean;

  // App Config & Integration State
  llmApiKey: string;
  groqApiKey: string;
  openaiApiKey: string;
  customApiEndpoint: string;
  customModelId: string;
  /**
   * How Slate reaches a model. 'apiKey' calls a provider with a pasted key; 'cli' drives an
   * AI CLI that is already signed in on this machine (OAuth), so no key is needed.
   */
  aiConnection: AiConnection;
  /** Which signed-in CLI to use in 'cli' mode. */
  cliTool: CliTool;
  /** Model passed to the CLI; empty means the CLI's own default. */
  cliModel: string;
  trocrUrl: string;
  expertRules: string;
  isAiProcessing: boolean;
  aiStatusText: string;
  activeModelName: string;
  selectedModelId: string;
  autoExecuteHandwriting: boolean;

  // Teacher Notes RAG State
  uploadedDocs: TeacherDocument[];

  // Chat Feed State
  chatMessages: ChatMessage[];
  isChatOpen: boolean;

  // RAG Actions
  addDocument: (doc: TeacherDocument) => void;
  updateDocument: (docId: string, patch: Partial<TeacherDocument>) => void;
  removeDocument: (docId: string) => void;
  clearDocuments: () => void;
  hydrateDocuments: () => Promise<void>;

  // Slide Deck Actions
  addSlide: () => string;
  deleteSlide: (id: string) => void;
  switchSlide: (id: string) => void;
  nextSlide: () => void;
  prevSlide: () => void;
  renameSlide: (id: string, title: string) => void;

  // Canvas Actions
  setActiveTool: (tool: ActiveTool) => void;
  setSelectedIds: (ids: string[]) => void;
  setConnectingFromId: (id: string | null) => void;
  setStageScale: (scale: number) => void;
  setStagePos: (pos: { x: number; y: number }) => void;
  setActiveColor: (color: NodeColor) => void;
  setInkColor: (color: string) => void;
  setPresenting: (presenting: boolean) => void;

  toggleChat: () => void;
  /** Returns the new message's id so a caller can fill details in once they arrive. */
  addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateChatMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearChat: () => void;

  setLlmApiKey: (key: string) => void;
  setGroqApiKey: (key: string) => void;
  setOpenaiApiKey: (key: string) => void;
  setCustomApiEndpoint: (url: string) => void;
  setCustomModelId: (id: string) => void;
  setAiConnection: (mode: AiConnection) => void;
  setCliTool: (tool: CliTool) => void;
  setCliModel: (model: string) => void;
  setTrocrUrl: (url: string) => void;
  setExpertRules: (rules: string) => void;
  setAiStatus: (isProcessing: boolean, text?: string) => void;
  setActiveModelName: (name: string) => void;
  setSelectedModelId: (modelId: string) => void;
  setAutoExecuteHandwriting: (enabled: boolean) => void;

  addNode: (node: Partial<BoardNode> & { type: BoardNode['type'] }) => string;
  updateNode: (id: string, patch: Partial<BoardNode>) => void;
  deleteNode: (id: string) => void;

  addEdge: (from: string, to: string, label?: string) => string;
  deleteEdge: (id: string) => void;

  addInk: (stroke: Omit<InkStroke, 'id'>) => string;
  deleteInk: (id: string) => void;

  indentNode: (id: string) => void;
  outdentNode: (id: string) => void;
  eraseAtPosition: (x: number, y: number, radius?: number) => void;

  clearBoard: () => void;
  
  // Undo / Redo
  undo: () => void;
  redo: () => void;
  
  getSceneGraph: () => SceneGraph;
}

const MAX_HISTORY = 30;

// Default initial slide 1 nodes (blank canvas)
const initialNodes: Record<string, BoardNode> = {};
const initialEdges: Record<string, BoardEdge> = {};

const initialSlides: Slide[] = [
  {
    id: 'slide_1',
    title: 'Slide 1',
    nodes: initialNodes,
    edges: initialEdges,
    ink: {}
  }
];

export type AiConnection = 'apiKey' | 'cli';
export type CliTool = 'agy' | 'claude';

/**
 * A saved choice wins. Otherwise: anyone who had picked the old "Antigravity" model was
 * already using a signed-in CLI, and a fresh install starts there too, since it needs no
 * key to try.
 */
function initialConnection(): AiConnection {
  const saved = localStorage.getItem('slate_ai_connection');
  if (saved === 'apiKey' || saved === 'cli') return saved;
  if (localStorage.getItem('slate_selected_model') === 'agy') return 'cli';
  const hasKey = ['slate_llm_key', 'slate_groq_key', 'slate_openai_key'].some((k) => localStorage.getItem(k));
  return hasKey ? 'apiKey' : 'cli';
}

export const useBoardStore = create<BoardStore>((set, get) => {
  const history: HistoryState[] = [];
  let historyIndex = -1;

  const pushHistory = (state: HistoryState) => {
    if (historyIndex < history.length - 1) {
      history.splice(historyIndex + 1);
    }
    history.push(JSON.parse(JSON.stringify(state)));
    if (history.length > MAX_HISTORY) {
      history.shift();
    } else {
      historyIndex++;
    }
  };

  const syncActiveSlide = (nodes: Record<string, BoardNode>, edges: Record<string, BoardEdge>, ink: Record<string, InkStroke>) => {
    const { slides, activeSlideId } = get();
    const updatedSlides = slides.map((s) => (s.id === activeSlideId ? { ...s, nodes, edges, ink } : s));
    set({ slides: updatedSlides });
  };

  return {
    slides: initialSlides,
    activeSlideId: 'slide_1',

    nodes: initialNodes,
    edges: initialEdges,
    ink: {},

    activeTool: 'select',
    selectedIds: [],
    connectingFromId: null,
    stageScale: 1,
    stagePos: { x: 0, y: 0 },
    activeColor: 'primary',
    // Ink is drawn on the white paper slide, so it defaults to paper ink, not shell ink.
    inkColor: '#14181a',
    isPresenting: false,

    llmApiKey: localStorage.getItem('slate_llm_key') || '',
    groqApiKey: localStorage.getItem('slate_groq_key') || '',
    openaiApiKey: localStorage.getItem('slate_openai_key') || '',
    customApiEndpoint: localStorage.getItem('slate_custom_endpoint') || '',
    customModelId: localStorage.getItem('slate_custom_model') || 'mistralai/mistral-7b-instruct',
    aiConnection: initialConnection(),
    cliTool: (localStorage.getItem('slate_cli_tool') as CliTool) || 'agy',
    cliModel: localStorage.getItem('slate_cli_model') ?? localStorage.getItem('slate_agy_model') ?? '',
    trocrUrl: localStorage.getItem('slate_trocr_url') || '',
    expertRules: localStorage.getItem('slate_expert_rules') ?? DEFAULT_EXPERT_RULES,
    isAiProcessing: false,
    aiStatusText: '',
    activeModelName: 'DeepSeek V4 Flash',
    // 'agy' used to be an entry in the API model list; it is now the CLI connection.
    selectedModelId:
      (localStorage.getItem('slate_selected_model') === 'agy' ? null : localStorage.getItem('slate_selected_model')) ||
      'deepseek-ai/deepseek-v4-flash',
    autoExecuteHandwriting: localStorage.getItem('slate_auto_execute') !== 'false',

    uploadedDocs: [],

    chatMessages: [
      {
        id: 'msg_init',
        sender: 'system',
        text: 'Welcome to Slate AI Whiteboard! Speak your commands or type questions to modify the current slide.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ],
    isChatOpen: false,

    // RAG Actions.
    // Every mutation mirrors to IndexedDB, so a refresh no longer discards the extracted
    // text, the diagram crops and the LLM-built tree — the index is paid for once.
    addDocument: (doc) => {
      const { uploadedDocs } = get();
      set({ uploadedDocs: [...uploadedDocs, doc] });
      void persistDocument(doc).then((saved) => {
        if (!saved) {
          get().addChatMessage({
            sender: 'system',
            text: `⚠️ "${doc.filename}" could not be saved in this browser, so it will be gone after a refresh. It works for this session.`
          });
        }
      });
    },

    // Indexing finishes seconds after the upload, so the tree is patched in rather than
    // the document being re-added.
    updateDocument: (docId, patch) => {
      const { uploadedDocs } = get();
      const updated = uploadedDocs.map((d) => (d.id === docId ? { ...d, ...patch } : d));
      set({ uploadedDocs: updated });

      const persisted = updated.find((d) => d.id === docId);
      if (persisted) void persistDocument(persisted);
    },

    removeDocument: (docId) => {
      const { uploadedDocs } = get();
      set({ uploadedDocs: uploadedDocs.filter((d) => d.id !== docId) });
      void removePersistedDocument(docId);
    },

    clearDocuments: () => {
      set({ uploadedDocs: [] });
      void clearPersistedDocuments();
    },

    // Called once at startup. Documents saved in a previous session are restored with their
    // trees intact; anything already in memory wins, so a hydrate racing an upload cannot
    // clobber the fresh document.
    hydrateDocuments: async () => {
      const stored = await loadPersistedDocuments();
      if (stored.length === 0) return;

      const { uploadedDocs } = get();
      const known = new Set(uploadedDocs.map((d) => d.id));
      const restored = stored.filter((d) => !known.has(d.id));
      if (restored.length === 0) return;

      set({ uploadedDocs: [...uploadedDocs, ...restored] });

      // Every PDF stores at least one image per page. One that comes back with none lost
      // them in storage — an early version of the split image store deleted them on re-save
      // — and would otherwise look fine while no diagram could ever be found in it.
      for (const doc of restored.filter((d) => /\.pdf$/i.test(d.filename) && d.images.length === 0)) {
        get().addChatMessage({
          sender: 'system',
          text: `⚠️ The pictures in "${doc.filename}" were lost from storage. Its text still works, but no diagram can be placed from it until you upload it again.`
        });
      }

      // Documents saved before the OCR pass existed are upgraded once, in the background:
      // their pictures gain descriptions of what they show and image-only pages become
      // searchable, without asking the teacher to upload them again.
      for (const doc of restored.filter(needsOcr)) {
        try {
          const patch = await ocrDocument(doc, (done, total) =>
            set({ aiStatusText: `Reading text inside pictures in ${doc.filename}... ${done}/${total}` })
          );
          get().updateDocument(doc.id, patch);
          const pictures = patch.images.filter((i) => i.kind === 'picture').length;
          get().addChatMessage({
            sender: 'system',
            text: `📖 Read the text inside ${pictures} picture(s) in ${doc.filename}, so its diagrams can now be found by what they show.`
          });
        } catch (err) {
          console.warn(`OCR upgrade failed for ${doc.filename}:`, err);
        } finally {
          set({ aiStatusText: '' });
        }
      }
    },

    // Slide Deck Actions
    addSlide: () => {
      const { slides } = get();
      const newId = `slide_${uuidv4().slice(0, 6)}`;
      const newSlide: Slide = {
        id: newId,
        title: `Slide ${slides.length + 1}`,
        nodes: {},
        edges: {},
        ink: {}
      };
      set({
        slides: [...slides, newSlide],
        activeSlideId: newId,
        nodes: {},
        edges: {},
        ink: {},
        selectedIds: []
      });
      return newId;
    },

    deleteSlide: (id: string) => {
      const { slides, activeSlideId, nodes, edges, ink } = get();
      if (slides.length <= 1) return;

      const deletedIndex = slides.findIndex((s) => s.id === id);
      if (deletedIndex === -1) return;

      // The live nodes/edges/ink belong to the active slide and are only written back on
      // switch — flush them first, or deleting any other slide discards the current edits.
      const flushed = slides.map((s) => (s.id === activeSlideId ? { ...s, nodes, edges, ink } : s));
      const remaining = flushed.filter((s) => s.id !== id);

      if (id !== activeSlideId) {
        set({ slides: remaining });
        return;
      }

      // Deleting the slide you are on lands on its neighbour, not always the last slide.
      const targetSlide = remaining[Math.min(deletedIndex, remaining.length - 1)];
      set({
        slides: remaining,
        activeSlideId: targetSlide.id,
        nodes: targetSlide.nodes,
        edges: targetSlide.edges,
        ink: targetSlide.ink,
        selectedIds: []
      });
    },

    switchSlide: (id: string) => {
      const { slides, nodes, edges, ink, activeSlideId } = get();
      if (id === activeSlideId) return;

      const updatedSlides = slides.map((s) => (s.id === activeSlideId ? { ...s, nodes, edges, ink } : s));
      const targetSlide = updatedSlides.find((s) => s.id === id);

      if (targetSlide) {
        set({
          slides: updatedSlides,
          activeSlideId: id,
          nodes: targetSlide.nodes,
          edges: targetSlide.edges,
          ink: targetSlide.ink,
          selectedIds: []
        });
      }
    },

    nextSlide: () => {
      const { slides, activeSlideId, switchSlide } = get();
      const index = slides.findIndex((s) => s.id === activeSlideId);
      if (index >= 0 && index < slides.length - 1) {
        switchSlide(slides[index + 1].id);
      }
    },

    prevSlide: () => {
      const { slides, activeSlideId, switchSlide } = get();
      const index = slides.findIndex((s) => s.id === activeSlideId);
      if (index > 0) {
        switchSlide(slides[index - 1].id);
      }
    },

    renameSlide: (id: string, title: string) => {
      const { slides } = get();
      set({
        slides: slides.map((s) => (s.id === id ? { ...s, title } : s))
      });
    },

    setActiveModelName: (name) => set({ activeModelName: name }),

    setSelectedModelId: (modelId) => {
      localStorage.setItem('slate_selected_model', modelId);
      set({ selectedModelId: modelId });
    },

    setAutoExecuteHandwriting: (enabled) => {
      localStorage.setItem('slate_auto_execute', enabled ? 'true' : 'false');
      set({ autoExecuteHandwriting: enabled });
    },

    toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),

    addChatMessage: (msg) => {
      const state = get();
      const newMsg: ChatMessage = {
        id: `msg_${uuidv4().slice(0, 6)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ...msg
      };
      set({ chatMessages: [...state.chatMessages, newMsg], isChatOpen: true });
      return newMsg.id;
    },

    // Lets a message be posted immediately and completed later — the scene-graph snippet
    // for a command is only known after retrieval, which must not delay the echo.
    updateChatMessage: (id, patch) => {
      const { chatMessages } = get();
      set({ chatMessages: chatMessages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
    },

    clearChat: () => set({ chatMessages: [] }),

    setActiveTool: (tool) => set({ activeTool: tool, connectingFromId: null }),
    setSelectedIds: (ids) => set({ selectedIds: ids }),
    setConnectingFromId: (id) => set({ connectingFromId: id }),
    setStageScale: (scale) => set({ stageScale: scale }),
    setStagePos: (pos) => set({ stagePos: pos }),
    setActiveColor: (color) => set({ activeColor: color }),
    setInkColor: (color) => set({ inkColor: color }),
    setPresenting: (presenting) =>
      set({ isPresenting: presenting, selectedIds: [], connectingFromId: null, activeTool: 'select' }),

    setLlmApiKey: (key) => {
      localStorage.setItem('slate_llm_key', key);
      set({ llmApiKey: key });
    },
    setGroqApiKey: (key) => {
      localStorage.setItem('slate_groq_key', key);
      set({ groqApiKey: key });
    },
    setOpenaiApiKey: (key) => {
      localStorage.setItem('slate_openai_key', key);
      set({ openaiApiKey: key });
    },
    setCustomApiEndpoint: (url) => {
      localStorage.setItem('slate_custom_endpoint', url);
      set({ customApiEndpoint: url });
    },
    setCustomModelId: (id) => {
      localStorage.setItem('slate_custom_model', id);
      set({ customModelId: id });
    },
    setAiConnection: (mode) => {
      localStorage.setItem('slate_ai_connection', mode);
      set({ aiConnection: mode });
    },
    setCliTool: (tool) => {
      localStorage.setItem('slate_cli_tool', tool);
      set({ cliTool: tool });
    },
    setCliModel: (model) => {
      localStorage.setItem('slate_cli_model', model);
      set({ cliModel: model });
    },
    setTrocrUrl: (url) => {
      localStorage.setItem('slate_trocr_url', url);
      set({ trocrUrl: url });
    },
    setExpertRules: (rules) => {
      localStorage.setItem('slate_expert_rules', rules);
      set({ expertRules: rules });
    },
    setAiStatus: (isProcessing, text = '') => set({ isAiProcessing: isProcessing, aiStatusText: text }),

    addNode: (nodeData) => {
      const state = get();
      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      const id = nodeData.id || `n${Object.keys(state.nodes).length + 1}`;
      const x = nodeData.x ?? 200;
      const y = nodeData.y ?? 200;
      const gridPos = nodeData.gridPos || coordsToGridPos(x, y);

      const label = nodeData.label !== undefined ? nodeData.label : '';
      const dims = computeDynamicNodeDimensions(nodeData.type, label);

      const newNode: BoardNode = {
        id,
        type: nodeData.type,
        label,
        gridPos,
        x,
        y,
        width: nodeData.width || dims.width,
        height: nodeData.height || dims.height,
        color: nodeData.color || state.activeColor,
        parentId: nodeData.parentId
      };

      const newNodes = { ...state.nodes, [id]: newNode };
      set({
        nodes: newNodes,
        selectedIds: [id]
      });

      syncActiveSlide(newNodes, state.edges, state.ink);
      return id;
    },

    updateNode: (id, patch) => {
      const state = get();
      const node = state.nodes[id];
      if (!node) return;

      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      const updatedX = patch.x ?? node.x;
      const updatedY = patch.y ?? node.y;
      const gridPos = coordsToGridPos(updatedX, updatedY);

      const updatedLabel = patch.label !== undefined ? patch.label : node.label;
      const newDims = patch.label !== undefined ? computeDynamicNodeDimensions(node.type, updatedLabel) : { width: node.width, height: node.height };

      const newNodes = {
        ...state.nodes,
        [id]: {
          ...node,
          ...patch,
          width: patch.width || Math.max(node.width, newDims.width),
          height: patch.height || Math.max(node.height, newDims.height),
          gridPos
        }
      };

      set({ nodes: newNodes });
      syncActiveSlide(newNodes, state.edges, state.ink);
    },

    deleteNode: (id) => {
      const state = get();
      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      const newNodes = { ...state.nodes };
      delete newNodes[id];

      const newEdges: Record<string, BoardEdge> = {};
      Object.values(state.edges).forEach((edge) => {
        if (edge.from !== id && edge.to !== id) {
          newEdges[edge.id] = edge;
        }
      });

      set({
        nodes: newNodes,
        edges: newEdges,
        selectedIds: state.selectedIds.filter((sid) => sid !== id)
      });
      syncActiveSlide(newNodes, newEdges, state.ink);
    },

    addEdge: (from, to, label) => {
      const state = get();
      if (from === to) return '';

      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      const id = `e${Object.keys(state.edges).length + 1}`;
      const newEdge: BoardEdge = { id, from, to, label };
      const newEdges = { ...state.edges, [id]: newEdge };

      set({
        edges: newEdges,
        connectingFromId: null
      });

      syncActiveSlide(state.nodes, newEdges, state.ink);
      return id;
    },

    deleteEdge: (id) => {
      const state = get();
      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      const newEdges = { ...state.edges };
      delete newEdges[id];

      set({ edges: newEdges });
      syncActiveSlide(state.nodes, newEdges, state.ink);
    },

    addInk: (strokeData) => {
      const state = get();
      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      const id = `ink_${uuidv4().slice(0, 6)}`;
      const stroke: InkStroke = { id, ...strokeData };
      const newInk = { ...state.ink, [id]: stroke };

      set({ ink: newInk });
      syncActiveSlide(state.nodes, state.edges, newInk);
      return id;
    },

    deleteInk: (id) => {
      const state = get();
      const newInk = { ...state.ink };
      delete newInk[id];
      set({ ink: newInk });
      syncActiveSlide(state.nodes, state.edges, newInk);
    },

    indentNode: (id) => {
      const state = get();
      const node = state.nodes[id];
      if (!node) return;

      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      let frameParentId: string | undefined = undefined;
      Object.values(state.nodes).forEach((fn) => {
        if (fn.id !== id && fn.type === 'frame') {
          if (
            node.x >= fn.x &&
            node.y >= fn.y &&
            node.x + node.width <= fn.x + fn.width &&
            node.y + node.height <= fn.y + fn.height
          ) {
            frameParentId = fn.id;
          }
        }
      });

      const updatedX = node.x + 40;
      const gridPos = coordsToGridPos(updatedX, node.y);

      const newNodes = {
        ...state.nodes,
        [id]: {
          ...node,
          x: updatedX,
          gridPos,
          parentId: frameParentId || node.parentId
        }
      };

      set({ nodes: newNodes });
      syncActiveSlide(newNodes, state.edges, state.ink);
    },

    outdentNode: (id) => {
      const state = get();
      const node = state.nodes[id];
      if (!node) return;

      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });

      const updatedX = Math.max(20, node.x - 40);
      const gridPos = coordsToGridPos(updatedX, node.y);

      const newNodes = {
        ...state.nodes,
        [id]: {
          ...node,
          x: updatedX,
          gridPos,
          parentId: undefined
        }
      };

      set({ nodes: newNodes });
      syncActiveSlide(newNodes, state.edges, state.ink);
    },

    eraseAtPosition: (x, y, radius = 25) => {
      const state = get();
      let modified = false;

      const newInk = { ...state.ink };
      Object.values(state.ink).forEach((stroke) => {
        const hits = stroke.points.some(([px, py]) => {
          const dx = px - x;
          const dy = py - y;
          return dx * dx + dy * dy <= radius * radius;
        });
        if (hits) {
          delete newInk[stroke.id];
          modified = true;
        }
      });

      const newNodes = { ...state.nodes };
      const erasedNodeIds: string[] = [];
      Object.values(state.nodes).forEach((node) => {
        if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
          delete newNodes[node.id];
          erasedNodeIds.push(node.id);
          modified = true;
        }
      });

      const newEdges = { ...state.edges };
      if (erasedNodeIds.length > 0) {
        Object.values(state.edges).forEach((edge) => {
          if (erasedNodeIds.includes(edge.from) || erasedNodeIds.includes(edge.to)) {
            delete newEdges[edge.id];
          }
        });
      }

      if (modified) {
        set({ ink: newInk, nodes: newNodes, edges: newEdges });
        syncActiveSlide(newNodes, newEdges, newInk);
      }
    },

    clearBoard: () => {
      const state = get();
      pushHistory({ nodes: state.nodes, edges: state.edges, ink: state.ink });
      set({ nodes: {}, edges: {}, ink: {}, selectedIds: [] });
      syncActiveSlide({}, {}, {});
    },

    undo: () => {
      if (historyIndex >= 0 && history[historyIndex]) {
        const prev = history[historyIndex];
        historyIndex--;
        set({ nodes: prev.nodes, edges: prev.edges, ink: prev.ink });
        syncActiveSlide(prev.nodes, prev.edges, prev.ink);
      }
    },

    redo: () => {
      if (historyIndex < history.length - 1 && history[historyIndex + 1]) {
        historyIndex++;
        const next = history[historyIndex];
        set({ nodes: next.nodes, edges: next.edges, ink: next.ink });
        syncActiveSlide(next.nodes, next.edges, next.ink);
      }
    },

    getSceneGraph: () => {
      const state = get();
      return {
        nodes: state.nodes,
        edges: state.edges,
        ink: state.ink,
        version: 1
      };
    }
  };
});
