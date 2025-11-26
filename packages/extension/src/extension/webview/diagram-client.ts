import 'reflect-metadata';
import 'sprotty/css/sprotty.css';
import './diagram-client.css';


import { Container, injectable } from 'inversify';
import {
  ConsoleLogger,
  IActionDispatcher,
  LogLevel,
  ModelViewer,
  LocalModelSource,
  PolylineEdgeView,
  RectangularNodeView,
  SEdgeImpl,
  SGraphImpl,
  SGraphView,
  SLabelImpl,
  SLabelView,
  SNodeImpl,
  SChildElementImpl,
  TYPES,
  configureModelElement,
  loadDefaultModules,
  overrideViewerOptions
} from 'sprotty';
import type { IView, RenderingContext } from 'sprotty';
import type { SModelRoot } from 'sprotty-protocol';
import { h } from 'snabbdom';
import type { VNode } from 'snabbdom';

// Create a simple Sprotty setup without sprotty-vscode-webview
function createOmlContainer(baseDiv: string): Container {
  const container = new Container();
  loadDefaultModules(container);
  // Client no longer performs layout; layout is computed on the server.
  overrideViewerOptions(container, {
    baseDiv,
    needsClientLayout: false,
    needsServerLayout: true
  });

  // Reduce noise from Sprotty
  container.rebind(TYPES.ILogger).to(ConsoleLogger).inSingletonScope();
  container.rebind(TYPES.LogLevel).toConstantValue(LogLevel.error);

  // No ELK factory binding needed on the client when layout is server-side.

  // Helper to get theme colors dynamically based on VS Code theme
  function getThemeColors() {
    const themeKind = document.documentElement.getAttribute('data-vscode-theme-kind');
    const isLight = themeKind === 'light';
    
    return {
      bgColor: isLight ? '#ffffff' : '#1e1e1e',
      edgeColor: isLight ? '#8e8e8e' : '#646695'
    };
  }

  // Custom views that keep markers in the VDOM
  class OmlGraphView extends SGraphView {
    override render(model: any, context: any) {
      const vnode: any = super.render(model, context);
      // Use 'ns' property to ensure SVG namespace for case-sensitive attributes
      const svgNS = 'http://www.w3.org/2000/svg';
      const { bgColor, edgeColor } = getThemeColors();
      const selectColor = '#00b7ff';
      const lightSelectColor = '#0066cc';
      const isLight = document.documentElement.getAttribute('data-vscode-theme-kind') === 'light';
      const activeSelectColor = isLight ? lightSelectColor : selectColor;

      const defs = h('defs', { ns: svgNS }, [
        // === Default state markers ===
        // Relation: open V-shaped arrow (default)
        h('marker#oml-open-arrow', {
          ns: svgNS,
          attrs: {
            viewBox: '0 0 14 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '16',
            markerHeight: '16',
            orient: 'auto'
          }
        }, [
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L12,6 L0,12',
              fill: 'none',
              stroke: edgeColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round'
            }
          })
        ]),
        // Specialization: closed filled triangle (default)
        h('marker#oml-closed-triangle', {
          ns: svgNS,
          attrs: {
            viewBox: '-2 0 14 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '16',
            markerHeight: '16',
            orient: 'auto',
            overflow: 'visible'
          }
        }, [
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L10,5 L0,10 Z',
              fill: bgColor,
              stroke: edgeColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'miter'
            }
          })
        ]),
        // Equivalence: closed triangle with double parallel stem ( ||> ) default
        h('marker#oml-equivalence-triangle', {
          ns: svgNS,
          attrs: {
            viewBox: '-8 0 20 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '20',
            markerHeight: '16',
            orient: 'auto',
            overflow: 'visible'
          }
        }, [
          // Parallel lines
          h('path', { ns: svgNS, attrs: { d: 'M-8,0 L-8,12', stroke: edgeColor, 'stroke-width': '1.5' } }),
          h('path', { ns: svgNS, attrs: { d: 'M-5,0 L-5,12', stroke: edgeColor, 'stroke-width': '1.5' } }),
          // Triangle
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L10,5 L0,10 Z',
              fill: bgColor,
              stroke: edgeColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'miter'
            }
          })
        ]),

        // === Hover state markers (cyan) ===
        // Relation: open V-shaped arrow (hover)
        h('marker#oml-open-arrow-hover', {
          ns: svgNS,
          attrs: {
            viewBox: '0 0 14 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '16',
            markerHeight: '16',
            orient: 'auto'
          }
        }, [
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L12,6 L0,12',
              fill: 'none',
              stroke: activeSelectColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round'
            }
          })
        ]),
        // Specialization: closed filled triangle (hover)
        h('marker#oml-closed-triangle-hover', {
          ns: svgNS,
          attrs: {
            viewBox: '-2 0 14 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '16',
            markerHeight: '16',
            orient: 'auto',
            overflow: 'visible'
          }
        }, [
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L10,5 L0,10 Z',
              fill: bgColor,
              stroke: activeSelectColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'miter'
            }
          })
        ]),
        // Equivalence hover
        h('marker#oml-equivalence-triangle-hover', {
          ns: svgNS,
          attrs: {
            viewBox: '-8 0 20 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '20',
            markerHeight: '16',
            orient: 'auto',
            overflow: 'visible'
          }
        }, [
          h('path', { ns: svgNS, attrs: { d: 'M-8,0 L-8,12', stroke: activeSelectColor, 'stroke-width': '1.5' } }),
          h('path', { ns: svgNS, attrs: { d: 'M-5,0 L-5,12', stroke: activeSelectColor, 'stroke-width': '1.5' } }),
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L10,5 L0,10 Z',
              fill: bgColor,
              stroke: activeSelectColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'miter'
            }
          })
        ]),

        // === Selected state markers (cyan) ===
        // Relation: open V-shaped arrow (selected)
        h('marker#oml-open-arrow-selected', {
          ns: svgNS,
          attrs: {
            viewBox: '0 0 14 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '16',
            markerHeight: '16',
            orient: 'auto'
          }
        }, [
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L12,6 L0,12',
              fill: 'none',
              stroke: activeSelectColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round'
            }
          })
        ]),
        // Specialization: closed filled triangle (selected)
        h('marker#oml-closed-triangle-selected', {
          ns: svgNS,
          attrs: {
            viewBox: '-2 0 14 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '16',
            markerHeight: '16',
            orient: 'auto',
            overflow: 'visible'
          }
        }, [
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L10,5 L0,10 Z',
              fill: bgColor,
              stroke: activeSelectColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'miter'
            }
          })
        ]),
        // Equivalence selected
        h('marker#oml-equivalence-triangle-selected', {
          ns: svgNS,
          attrs: {
            viewBox: '-8 0 20 12',
            refX: '12',
            refY: '6',
            markerUnits: 'userSpaceOnUse',
            markerWidth: '20',
            markerHeight: '16',
            orient: 'auto',
            overflow: 'visible'
          }
        }, [
          h('path', { ns: svgNS, attrs: { d: 'M-8,0 L-8,12', stroke: activeSelectColor, 'stroke-width': '1.5' } }),
          h('path', { ns: svgNS, attrs: { d: 'M-5,0 L-5,12', stroke: activeSelectColor, 'stroke-width': '1.5' } }),
          h('path', {
            ns: svgNS,
            attrs: {
              d: 'M0,0 L10,5 L0,10 Z',
              fill: bgColor,
              stroke: activeSelectColor,
              'stroke-width': '1.5',
              'stroke-linejoin': 'miter'
            }
          })
        ])
      ]);
      (vnode as any).children = (vnode as any).children ? [defs, ...(vnode as any).children] : [defs];
      return vnode;
    }
  }

  class OmlEdgeView extends PolylineEdgeView {
    protected override renderLine(edge: any, segments: any[], context: any, args?: any): VNode {
      const lineVNode = super.renderLine(edge, segments, context, args) as VNode;
      const kind = (edge as any)?.kind ?? (edge as any)?.data?.kind ?? 'relation';
      const hasMarker = (edge as any)?.hasMarker ?? true; // default to true for backward compatibility
      // Determine which marker to use based on edge kind and hasMarker flag
      let markerId: string | undefined;
      if (kind === 'specialization') {
        markerId = 'oml-closed-triangle';
      } else if (kind === 'equivalence' && hasMarker) {
        markerId = 'oml-equivalence-triangle';
      } else if (kind === 'relation' && hasMarker) {
        markerId = 'oml-open-arrow';
      }
      const attrsTarget = (lineVNode.data ?? (lineVNode.data = {})) as any;
      const attrs = (attrsTarget.attrs ?? (attrsTarget.attrs = {}));
      delete attrs['marker-start'];
      delete attrs['marker-mid'];
      if (markerId) {
        attrs['marker-end'] = `url(#${markerId})`;
      } else {
        delete attrs['marker-end'];
      }
      return lineVNode;
    }

    // Safer approach: adjust the label VNode during render so transforms are composed
    // before DOM creation. This avoids post-hoc DOM mutations and composes with any
    // existing transform. We apply a small vertical offset derived from model.labelIndex.
    override render(model: any, context: any) {
      const vnode = super.render(model, context) as VNode;
      try {
        const rawIndex = (model as any).labelIndex ?? (model?.data?.labelIndex ?? 0);
        const idx = typeof rawIndex === 'number' ? Math.max(0, rawIndex) : 0;
        if (idx > 0) {
          const LABEL_GAP = 10; // px per step; tuned small to avoid large jumps
          // map 0 -> 0, 1 -> -1, 2 -> +1, 3 -> -2, 4 -> +2, ...
          const pairIndex = Math.ceil(idx / 2);
          const sign = (idx % 2 === 0) ? 1 : -1;
          const offsetY = pairIndex * LABEL_GAP * sign;

          // Find the label VNode. The label is usually a child group with class 'sprotty-label'.
          const findLabelVNode = (n?: any): VNode | undefined => {
            if (!n || !n.children) return undefined;
            for (const c of n.children) {
              const cls = c?.data?.class;
              if (cls && (cls['sprotty-label'] || cls['sprotty_label'])) return c as VNode;
              // fallback: if a child contains a 'text' node, treat it as label group
              if (c.children && c.children.some((cc: any) => cc && cc.sel === 'text')) return c as VNode;
              const found = findLabelVNode(c);
              if (found) return found;
            }
            return undefined;
          };

          const labelVNode = findLabelVNode(vnode as any);
          if (labelVNode) {
            const data = labelVNode.data ?? (labelVNode.data = {});
            const attrs = data.attrs ?? (data.attrs = {});
            const existing = typeof attrs.transform === 'string' ? attrs.transform : (data.props?.transform ?? '');
            const translate = `translate(0, ${offsetY})`;
            // Compose by prepending our translate so any existing transforms remain
            const newTransform = existing ? `${translate} ${existing}` : translate;
            attrs.transform = newTransform;
          }
        }
      } catch (e) {
        // swallow errors to avoid breaking rendering
      }
      return vnode;
    }
  }

  // Custom rectangular node view to draw a compartment separator line below the label
  class OmlRectNodeView extends RectangularNodeView {
    override render(model: any, context: RenderingContext): VNode {
      const group = super.render(model, context) as VNode;
      const svgNS = 'http://www.w3.org/2000/svg';
      try {
        const width: number = (model.size?.width ?? model.bounds?.width ?? 120) as number;
        const height: number = (model.size?.height ?? model.bounds?.height ?? 56) as number;
        const padding = 10; // inset from node sides
        
        // Render types above the label if present
        const types: string[] = model.types ?? [];
        if (types.length > 0 && Array.isArray((group as any).children)) {
          const typesText = `«${types.join(', ')}»`;
          const typesVNode = (h as any)('text', {
            ns: svgNS,
            attrs: {
              x: width / 2,
              y: padding + 2,
              fill: '#888888',
              'font-size': '11px',
              'font-family': 'Consolas, Monaco, monospace',
              'text-anchor': 'middle',
              'dominant-baseline': 'hanging'
            },
            class: { 'oml-types-label': true }
          }, typesText);
          (group as any).children.push(typesVNode);
        }
        
        // Find the first label child to place the line below it
        const label = (model.children ?? []).find((c: any) => c.type === 'label');
        // Use laid-out bounds when available; otherwise best-effort defaults.
        // This keeps the line relative to the real label box rather than a hard-coded offset.
        const fontSize = 13;          // visual fallback height for single-line label
        const gap = 6;                // space between label bottom and separator
        const labelY = (label?.bounds && Number.isFinite(label.bounds.y)) ? (label.bounds.y as number) : 0;
        const labelH = (label?.bounds && Number.isFinite(label.bounds.height) && (label.bounds.height as number) > 0)
          ? (label.bounds.height as number)
          : fontSize;
  const compartmentY = Math.max(padding, Math.min(height - padding, labelY + labelH + gap));

        const lineVNode = (h as any)('line', {
          ns: svgNS,
          class: { 'oml-compartment-line': true },
          attrs: {
            x1: padding,
            y1: compartmentY,
            x2: Math.max(padding, width - padding),
            y2: compartmentY,
            'shape-rendering': 'geometricPrecision'
          }
        });

        // Append the separator line so it's drawn on top of the rect but behind labels
        if (Array.isArray((group as any).children)) {
          (group as any).children.push(lineVNode);
          // Render property labels from custom data (model.props)
          const properties: string[] = model.props ?? [];
          const lineGap = 6;
          const perHeight = 16;
          properties.forEach((p, idx) => {
            const py = compartmentY + lineGap + idx * perHeight;
            // property label y computed
            // Create text node with explicit fill color
            const textVNode = (h as any)('text', {
              ns: svgNS,
              attrs: {
                x: padding + 4,
                y: py,
                fill: '#ce9178',
                'font-size': '12px',
                'font-family': 'Consolas, Monaco, monospace',
                'text-anchor': 'start',
                'dominant-baseline': 'hanging'
              },
              class: { 'oml-property-label': true }
            }, p);
            (group as any).children.push(textVNode);
          });
        }
      } catch {/* ignore drawing errors */}
      return group;
    }
  }

  // No client-side LayoutConfigurator necessary when layout is server-side.

  // Model elements
  configureModelElement(container, 'graph', SGraphImpl, OmlGraphView);
  configureModelElement(container, 'node:rect', SNodeImpl, OmlRectNodeView);
  // Use the default label view
  configureModelElement(container, 'label', SLabelImpl, SLabelView);
  configureModelElement(container, 'edge', SEdgeImpl, OmlEdgeView);

  // Register no-op views for routing handles to silence missing-view errors.
  // These are added by Sprotty's routing feedback; we don't need to render them.
  @injectable()
  class EmptyView implements IView {
    render(element: any, context: RenderingContext): VNode {
      const svgNS = 'http://www.w3.org/2000/svg';
      return (h as any)('g', { ns: svgNS, attrs: { visibility: 'hidden' } }, []);
    }
  }
  configureModelElement(container, 'routing-point', SChildElementImpl, EmptyView as any);
  configureModelElement(container, 'volatile-routing-point', SChildElementImpl, EmptyView as any);
  configureModelElement(container, 'bezier-routing-point', SChildElementImpl, EmptyView as any);
  configureModelElement(container, 'bezier-create-routing-point', SChildElementImpl, EmptyView as any);
  configureModelElement(container, 'bezier-remove-routing-point', SChildElementImpl, EmptyView as any);

  // Do not register a client-side layout configurator.

  // Ensure LocalModelSource is bound
  if (!container.isBound(TYPES.ModelSource)) {
    container.bind(TYPES.ModelSource).to(LocalModelSource).inSingletonScope();
  }

  // Disable the move module so nodes cannot be dragged.
  // The moveModule binds MoveMouseListener as a TYPES.MouseListener.
  // We unbind all move-related listeners to prevent node movement.
  if (container.isBound(TYPES.MouseListener)) {
    const allListeners = container.getAll(TYPES.MouseListener);
    const filtered = allListeners.filter((listener: any) => {
      const ctor = listener?.constructor?.name || '';
      return !ctor.includes('Move');
    });
    if (filtered.length > 0) {
      container.unbind(TYPES.MouseListener);
      filtered.forEach(listener => {
        container.bind(TYPES.MouseListener).toConstantValue(listener);
      });
    }
  }

  return container;
}

// Bootstrap viewer
const BASE_DIV_ID = 'sprotty';
const container = createOmlContainer(BASE_DIV_ID);
const viewer = container.get<ModelViewer>(ModelViewer);
const modelSource = container.get<LocalModelSource>(TYPES.ModelSource);
// No client-side layout engine – server provides laid-out SModel
let actionDispatcher = container.get<IActionDispatcher>(TYPES.IActionDispatcher);

    // Wrap dispatcher to block moves as final safety net.
  // Markers inherit selection styling via CSS, so no JS color update needed.
  const originalDispatch = actionDispatcher.dispatch.bind(actionDispatcher);
  (actionDispatcher as any).dispatch = (action: any) => {
    if (action?.kind === 'setBounds') {
      return;
    }
    return originalDispatch(action);
  };

// Wire message handling
// VS Code webview API declaration for TS
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscodeApi = acquireVsCodeApi();

// Store the current diagram model for looking up element metadata
let currentDiagramModel: any = null;

// Helper to recursively find an element by ID in the model
function findElementById(model: any, id: string): any {
  if (!model) return null;
  if (model.id === id) return model;
  if (model.children) {
    for (const child of model.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  }
  return null;
}

// Watch for selection class changes on edges and swap marker references
function setupMarkerColorWatcher() {
  const root = document.getElementById(BASE_DIV_ID);
  if (!root) return;

  const svg = root.querySelector('svg');
  if (!svg) return;

  const updateMarkerReferences = () => {
    // Get all edges in the diagram
    const edges = svg.querySelectorAll('g.sprotty-edge');
    edges.forEach((edge) => {
      const isSelected = edge.classList.contains('selected');
      const hasHoverAttr = edge.hasAttribute('data-hover');
      // Find the polyline, path, or line element with marker-end attribute
      const lineElement = edge.querySelector('polyline, path, line') as SVGElement | null;
      if (!lineElement) return;
      const currentMarkerEnd = lineElement.getAttribute('marker-end');
      if (!currentMarkerEnd) return;
      // Determine which marker is being used
      const isOpenArrow = currentMarkerEnd.includes('oml-open-arrow');
      const isClosedTriangle = currentMarkerEnd.includes('oml-closed-triangle');
      const isEquivalenceTriangle = currentMarkerEnd.includes('oml-equivalence-triangle');
      let newMarkerEnd: string;
      if (isSelected) {
        // Switch to selected marker variants
        if (isOpenArrow) {
          newMarkerEnd = 'url(#oml-open-arrow-selected)';
        } else if (isClosedTriangle) {
          newMarkerEnd = 'url(#oml-closed-triangle-selected)';
        } else if (isEquivalenceTriangle) {
          newMarkerEnd = 'url(#oml-equivalence-triangle-selected)';
        } else {
          return;
        }
      } else if (hasHoverAttr) {
        // Switch to hover marker variants
        if (isOpenArrow) {
          newMarkerEnd = 'url(#oml-open-arrow-hover)';
        } else if (isClosedTriangle) {
          newMarkerEnd = 'url(#oml-closed-triangle-hover)';
        } else if (isEquivalenceTriangle) {
          newMarkerEnd = 'url(#oml-equivalence-triangle-hover)';
        } else {
          return;
        }
      } else {
        // Switch back to default markers
        if (isOpenArrow) {
          newMarkerEnd = 'url(#oml-open-arrow)';
        } else if (isClosedTriangle) {
          newMarkerEnd = 'url(#oml-closed-triangle)';
        } else if (isEquivalenceTriangle) {
          newMarkerEnd = 'url(#oml-equivalence-triangle)';
        } else {
          return;
        }
      }
      // Update the marker reference if it changed
      if (lineElement.getAttribute('marker-end') !== newMarkerEnd) {
        lineElement.setAttribute('marker-end', newMarkerEnd);
      }
    });
  };

  // (label offsetting removed) Keep marker reference updates simple and stable.

  // Use MutationObserver to watch for class and hover changes and propagate
  // selection/hover across relation-entity components (node + its two edges).
  const observer = new MutationObserver((mutations) => {
    // Process each mutation to propagate selection/hover to linked components
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      const attr = m.attributeName;
      if (attr !== 'class' && attr !== 'data-hover') continue;
      const target = m.target as Element | null;
      if (!target) continue;

      // Determine DOM id (may be on parent)
      let domId = (target.getAttribute && target.getAttribute('id')) || undefined;
      if (!domId && (target.parentElement)) domId = target.parentElement.getAttribute('id') || undefined;
      if (!domId) continue;

      // DOM id is same as model id (no prefix)
      const baseId = domId;

      // Determine relation base name: node id or edge-derived base
      // For vocabulary relation entities: qualifiedName-edge1, qualifiedName-edge2
      const relationBase = baseId.replace(/-edge[12]$/, '');
      
      // For description relation instances: qualifiedName-source-edge#, qualifiedName-target-edge#
      const descRelationMatch = baseId.match(/^(.+?)-(source|target)-edge\d+$/);
      const descRelationBase = descRelationMatch ? descRelationMatch[1] : null;

      // Resolve DOM elements for vocabulary relation entity (node + edge1 + edge2)
      const nodeEl = document.getElementById(relationBase);
      const edge1El = document.getElementById(`${relationBase}-edge1`);
      const edge2El = document.getElementById(`${relationBase}-edge2`);

      // Helper to add/remove attribute/class only when necessary
      const setSelected = (el: Element | null, sel: boolean) => {
        if (!el) return;
        const has = el.classList.contains('selected');
        if (sel && !has) el.classList.add('selected');
        else if (!sel && has) el.classList.remove('selected');
      };
      const setHover = (el: Element | null, hover: boolean) => {
        if (!el) return;
        const has = el.hasAttribute('data-hover');
        if (hover && !has) el.setAttribute('data-hover', 'true');
        else if (!hover && has) el.removeAttribute('data-hover');
      };

      if (attr === 'class') {
        const isSelected = target.classList.contains('selected');
        
        // Propagate selection to vocabulary relation entity (node + edge1 + edge2)
        setSelected(nodeEl, isSelected);
        setSelected(edge1El, isSelected);
        setSelected(edge2El, isSelected);
        
        // Propagate selection to description relation instance (node + all source/target edges)
        if (descRelationBase) {
          const svg = document.getElementById(BASE_DIV_ID)?.querySelector('svg');
          if (svg) {
            const allElements = svg.querySelectorAll('[id]');
            allElements.forEach((el) => {
              const elId = el.getAttribute('id') || '';
              // Match node or any source/target edge
              if (elId === descRelationBase || elId.startsWith(`${descRelationBase}-source-edge`) || elId.startsWith(`${descRelationBase}-target-edge`)) {
                setSelected(el, isSelected);
              }
            });
          }
        }
        
        // Check if this is part of an equivalence axiom group
        // Equivalence group IDs match pattern: [subQualifiedName]<->[index] for node
        // and [subQualifiedName]<->[index]-edge1, -edge2, -edge3, etc. for edges
        const eqMatch = baseId.match(/^(.+?)<->(\[?\d+\]?)(-edge\d+)?$/);
        if (eqMatch) {
          // This is part of an equivalence group
          const eqPrefix = `${eqMatch[1]}<->${eqMatch[2]}`;
          // Find all elements with this prefix (node + all edges)
          const svg = document.getElementById(BASE_DIV_ID)?.querySelector('svg');
          if (svg) {
            const allElements = svg.querySelectorAll('[id]');
            allElements.forEach((el) => {
              const elId = el.getAttribute('id') || '';
              if (elId.startsWith(eqPrefix)) {
                setSelected(el, isSelected);
              }
            });
          }
        }
      } else if (attr === 'data-hover') {
        const isHover = target.hasAttribute('data-hover');
        setHover(nodeEl, isHover);
        setHover(edge1El, isHover);
        setHover(edge2El, isHover);
      }
    }
    // After propagation, update markers once
    updateMarkerReferences();
  });

  // Watch the SVG subtree for class and attribute changes
  observer.observe(svg, {
    subtree: true,
    attributeFilter: ['class', 'data-hover'],
    attributeOldValue: true
  });

  // Only support selection propagation for relation entity components
  // Remove all hover propagation logic for group
  // Initial update
  updateMarkerReferences();
}

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message?.type === 'theme') {
    try {
      const kind = message.kind === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-vscode-theme-kind', kind);
      // Update marker colors to match the new theme without forcing a full rerender
      try {
        updateMarkerDefsForCurrentTheme();
      } catch {}
    } catch {}
    return;
  }
  if (message?.type === 'updateModel') {
    try {
  // Server now provides a fully laid-out SModel; set it directly.
      const root: SModelRoot = message.model as SModelRoot;
      // Store the model for element lookup
      currentDiagramModel = root;
  try { /* updateModel received */ } catch {}
      // Prefer morphing updates for smooth animations.
      try {
        // Dispatch UpdateModel action so animationModule can morph the view.
        actionDispatcher.dispatch({ kind: 'updateModel', newRoot: root, animate: true } as any);
      } catch (_) {
        // Fallback to LocalModelSource if dispatcher path is not available.
        if (typeof (modelSource as any).updateModel === 'function') {
          (modelSource as any).updateModel(root);
        } else {
          modelSource.setModel(root);
        }
      }
      // Set up marker watcher after first model load
      setTimeout(() => setupMarkerColorWatcher(), 100);
    } catch (err) {
      console.error('[OML Diagram] Error processing model:', err);
    }
  }
});

// Ask extension host for a model on startup
vscodeApi.postMessage({ type: 'requestModel' });

// No client-side transformation; the server provides the SModel directly.

// --- Lightweight pan + zoom -----------------------------------------------------------
// Apply a CSS transform to the base '#sprotty' div to support drag-to-pan
// and wheel/pinch-to-zoom without touching Sprotty's internal camera state.
(() => {
  const root = document.getElementById(BASE_DIV_ID) as HTMLElement | null;
  if (!root) {
    return;
  }
  // Use the base container as the transform target for reliability
  const target = root;

  // State
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let panX = 0;
  let panY = 0;
  let scale = 1;
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 3;
  
  // Expose reset function for double-click handler
  (root as any).__resetView = () => {
    panX = 0;
    panY = 0;
    scale = 1;
    setTransform();
  };

  // Touch pinch state
  let pinchActive = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartPanX = 0;
  let pinchStartPanY = 0;
  let pinchCenterX = 0;
  let pinchCenterY = 0;

  // Helpers
  const setTransform = () => {
    target.style.transformOrigin = '0 0';
    target.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  };

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  // Zoom logic that keeps the screen point (cx, cy) stable while changing scale
  const zoomAt = (newScale: number, cx: number, cy: number) => {
    const s0 = scale;
    const s1 = clamp(newScale, MIN_SCALE, MAX_SCALE);
    if (s1 === s0) return;
    // Keep point (cx, cy) stationary: pan' = pan + (1 - s1/s0) * (p - pan)
    panX = panX + (1 - s1 / s0) * (cx - panX);
    panY = panY + (1 - s1 / s0) * (cy - panY);
    scale = s1;
    setTransform();
  };

  // Mouse panning (background or middle mouse)
  const onMouseDown = (e: MouseEvent) => {
    const el = e.target as Element;
    const hitInteractive = el.closest('g.sprotty-node, g.sprotty-edge') !== null;
    // Start panning on middle button anywhere, or left button on background only
    if (e.button === 1 || (e.button === 0 && !hitInteractive)) {
      isPanning = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      root.style.cursor = 'grabbing';
      // Don't preventDefault on mousedown - it blocks double-click events
      // Only prevent during mousemove to stop text selection while panning
    }
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    setTransform();
    e.preventDefault(); // Prevent text selection while panning
  };
  const onMouseUp = () => {
    if (!isPanning) return;
    isPanning = false;
    root.style.cursor = 'grab';
  };

  // Wheel zoom (trackpad pinch is also delivered as a wheel event in Chromium)
  const onWheel = (e: WheelEvent) => {
    // Zoom toward the pointer position
    const rect = root.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Smooth zoom factor; negative deltaY zooms in
    const zoomFactor = Math.exp(-e.deltaY * 0.001);
    zoomAt(scale * zoomFactor, cx, cy);
    e.preventDefault();
  };

  // Touch: one finger pans, two fingers pinch-zoom (and pan)
  const getTouch = (e: TouchEvent, index: number) => e.touches.item(index)!;
  const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      const t = getTouch(e, 0);
      isPanning = true;
      startX = t.clientX - panX;
      startY = t.clientY - panY;
    } else if (e.touches.length === 2) {
      pinchActive = true;
      const t0 = getTouch(e, 0);
      const t1 = getTouch(e, 1);
      pinchStartDist = dist(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
      pinchStartScale = scale;
      pinchStartPanX = panX;
      pinchStartPanY = panY;
      const rect = root.getBoundingClientRect();
      pinchCenterX = (t0.clientX + t1.clientX) / 2 - rect.left;
      pinchCenterY = (t0.clientY + t1.clientY) / 2 - rect.top;
      isPanning = false; // defer to pinch
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    if (pinchActive && e.touches.length === 2) {
      const t0 = getTouch(e, 0);
      const t1 = getTouch(e, 1);
      const d = dist(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
      const newScale = clamp(pinchStartScale * (d / pinchStartDist), MIN_SCALE, MAX_SCALE);
      // Update pan to keep pinch center stable across scale change
      const s0 = scale;
      const s1 = newScale;
      panX = pinchStartPanX + (1 - s1 / s0) * (pinchCenterX - pinchStartPanX);
      panY = pinchStartPanY + (1 - s1 / s0) * (pinchCenterY - pinchStartPanY);
      scale = newScale;
      setTransform();
      e.preventDefault();
      return;
    }
    if (isPanning && e.touches.length === 1) {
      const t = getTouch(e, 0);
      panX = t.clientX - startX;
      panY = t.clientY - startY;
      setTransform();
      e.preventDefault();
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      isPanning = false;
      pinchActive = false;
    } else if (e.touches.length === 1) {
      // back to single-finger pan
      pinchActive = false;
      const t = getTouch(e, 0);
      startX = t.clientX - panX;
      startY = t.clientY - panY;
    }
  };

  // Init styles and listeners
  root.style.willChange = 'transform';
  root.style.cursor = 'grab';
  root.addEventListener('mousedown', onMouseDown, { capture: true });

  // Prevent node dragging: swallow drag events originating on nodes but allow click for selection.
  // IMPORTANT: Don't prevent default or stop propagation on mousedown, as that blocks double-click.
  root.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    const targetEl = e.target as Element;
    const onNode = targetEl.closest('g.sprotty-node') !== null;
    if (!onNode) return;
    // Only intercept mousemove events to prevent dragging
    // Don't use stopImmediatePropagation - just preventDefault to allow event flow
    const cancelDrag = (ev: MouseEvent) => {
      ev.preventDefault(); // Prevent default drag behavior
      // Don't stop propagation - let events flow normally
    };
    const up = () => {
      window.removeEventListener('mousemove', cancelDrag, true);
      window.removeEventListener('mouseup', up, true);
    };
    window.addEventListener('mousemove', cancelDrag, true);
    window.addEventListener('mouseup', up, true);
  }, { capture: true });
  window.addEventListener('mousemove', onMouseMove, { capture: true });
  window.addEventListener('mouseup', onMouseUp, { capture: true });
  root.addEventListener('wheel', onWheel, { passive: false, capture: true });

  root.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  window.addEventListener('touchend', onTouchEnd, { capture: true });
})();

// Double-click handler: navigate to element or reset view
// Listen at window level with capture to intercept all double-clicks
(() => {
  const root = document.getElementById(BASE_DIV_ID);
  if (!root) return;
  
  
  // Handle double-clicks at window level before they reach any other handlers
  window.addEventListener('dblclick', (e: MouseEvent) => {
    
    // Check if the target is within our diagram
    const target = e.target as Element;
    const inDiagram = target.closest(`#${BASE_DIV_ID}`) !== null;
    
    if (!inDiagram) {
      return;
    }
    
    // Check if we clicked on a node or edge
    // The target might be the element itself or a child, so check both
    const targetClasses = (target.className && typeof target.className === 'object' && 'baseVal' in target.className) 
      ? (target.className as any).baseVal 
      : (target.className || '');
    
    let element: Element | null = null;
    
    // Check if target itself is a node or edge
    if (targetClasses.includes('sprotty-node')) {
      element = target;
    } else if (targetClasses.includes('sprotty-edge')) {
      element = target;
    } else {
      // Search up the tree for a parent that's a node or edge
      element = target.closest('[class*="sprotty-node"]') || target.closest('[class*="sprotty-edge"]');
    }
    
    if (element) {
      // Prevent default behavior and stop propagation
      e.preventDefault();
      e.stopPropagation();

      // Extract the element ID - check both id attribute and parent's id
      let elementId = element.getAttribute('id');
      if (!elementId && element.parentElement) {
        elementId = element.parentElement.getAttribute('id');
      }
      console.log('Double-clicked element ID:', element);
      // Strip the sprotty_ prefix that Sprotty adds to DOM elements
      if (elementId && elementId.startsWith('sprotty_')) {
        elementId = elementId.substring('sprotty_'.length);
      }

      if (elementId && currentDiagramModel) {
        // DOM id is same as model id (after stripping sprotty_ prefix)
        const searchId = elementId;

        let elementIdToSend = searchId;
        
        // Check if this is a relation entity edge (format: qualifiedName-edge1 or qualifiedName-edge2)
        if (searchId.endsWith('-edge1') || searchId.endsWith('-edge2')) {
          // Extract the qualified name (remove -edge1 or -edge2 suffix)
          const qualifiedName = searchId.replace(/-edge[12]$/, '');
          // Verify this is actually a relation entity by checking if the node exists
          const node = findElementById(currentDiagramModel, qualifiedName);
          if (node && node.type?.startsWith('node') && node.kind === 'relation-entity') {
            elementIdToSend = qualifiedName;
          }
        }
        // Check if this is a description relation instance edge (format: qualifiedName-source-edge# or qualifiedName-target-edge#)
        else if (searchId.match(/^.+-(?:source|target)-edge\d+$/)) {
          const match = searchId.match(/^(.+?)-(?:source|target)-edge\d+$/);
          if (match) {
            const qualifiedName = match[1];
            // Verify this is actually a relation instance by checking if the node exists
            const node = findElementById(currentDiagramModel, qualifiedName);
            if (node && node.type?.startsWith('node') && node.kind === 'relation-instance') {
              elementIdToSend = qualifiedName;
            }
          }
        }
        // Check if this is an equivalence axiom edge (format: [sub]<->[index]-edge#)
        // Note: brackets are literal characters, need to escape them in regex
        else if (searchId.match(/^\[.+?\]<->\[\d+\]-edge\d+$/)) {
          const match = searchId.match(/^\[(.+?)\]<->\[\d+\]-edge\d+$/);
          if (match) {
            elementIdToSend = match[1]; // sub term qualified name
          }
        }
        // Check if this is an equivalence axiom node (format: [sub]<->[index])
        else if (searchId.match(/^\[.+?\]<->\[\d+\]$/)) {
          const match = searchId.match(/^\[(.+?)\]<->\[\d+\]$/);
          if (match) {
            elementIdToSend = match[1]; // sub term qualified name
          }
        }
        // Check if this is a specialization edge (format: [sub]->[super])
        else if (searchId.match(/^\[.+?\]->\[.+?\]$/)) {
          const match = searchId.match(/^\[(.+?)\]->\[(.+?)\]$/);
          if (match) {
            elementIdToSend = match[1]; // sub term qualified name
          }
        }
        // Check if this is a direct equivalence edge (format: [sub]<->[super])
        else if (searchId.match(/^\[.+?\]<->\[.+?\]$/)) {
          const match = searchId.match(/^\[(.+?)\]<->\[(.+?)\]$/);
          if (match) {
            elementIdToSend = match[1]; // sub term qualified name
          }
        }

        // Send the element ID for navigation
        vscodeApi.postMessage({
          type: 'navigateToElement',
          elementId: elementIdToSend
        });
        return;
      }
    }
    
    // No element clicked - reset view
    const resetView = (root as any).__resetView;
    if (typeof resetView === 'function') {
      resetView();
    }
  }, { capture: true });
})();

// Update existing SVG marker definitions to reflect current theme colors
function updateMarkerDefsForCurrentTheme() {
  const root = document.getElementById(BASE_DIV_ID);
  if (!root) return;
  const svg = root.querySelector('svg');
  if (!svg) return;

  const themeKind = document.documentElement.getAttribute('data-vscode-theme-kind');
  const isLight = themeKind === 'light';
  const bgColor = isLight ? '#ffffff' : '#1e1e1e';
  const edgeColor = isLight ? '#8e8e8e' : '#646695';
  const selectColor = isLight ? '#0066cc' : '#00b7ff';

  // Helpers to set attributes safely
  const setAttrs = (el: Element | null, attrs: Record<string, string>) => {
    if (!el) return;
    for (const [k, v] of Object.entries(attrs)) {
      (el as any).setAttribute(k, v);
    }
  };

  // Open arrow markers
  setAttrs(svg.querySelector('marker#oml-open-arrow path'), { stroke: edgeColor, fill: 'none' });
  setAttrs(svg.querySelector('marker#oml-open-arrow-hover path'), { stroke: selectColor, fill: 'none' });
  setAttrs(svg.querySelector('marker#oml-open-arrow-selected path'), { stroke: selectColor, fill: 'none' });

  // Closed triangle markers
  setAttrs(svg.querySelector('marker#oml-closed-triangle path'), { stroke: edgeColor, fill: bgColor });
  setAttrs(svg.querySelector('marker#oml-closed-triangle-hover path'), { stroke: selectColor, fill: bgColor });
  setAttrs(svg.querySelector('marker#oml-closed-triangle-selected path'), { stroke: selectColor, fill: bgColor });

  // Equivalence triangle markers: two stem lines + triangle
  const updateEquiv = (id: string, strokeColor: string) => {
    const m = svg.querySelector(`marker#${id}`);
    if (!m) return;
    const paths = m.querySelectorAll('path');
    if (paths.length >= 3) {
      // first two vertical lines
      setAttrs(paths[0], { stroke: strokeColor });
      setAttrs(paths[1], { stroke: strokeColor });
      // last is the triangle
      setAttrs(paths[2], { stroke: strokeColor, fill: bgColor });
    }
  };
  updateEquiv('oml-equivalence-triangle', edgeColor);
  updateEquiv('oml-equivalence-triangle-hover', selectColor);
  updateEquiv('oml-equivalence-triangle-selected', selectColor);
}
