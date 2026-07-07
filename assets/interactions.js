(function () {
  "use strict";

  var activeGraph = null;
  var panState = null;
  var nodeDragState = null;
  var annotationDragState = null;
  var annotationDrawState = null;
  var selectedNode = null;
  var selectedElement = null;
  var graphEditors = new Map();
  var zoomMin = 0.55;
  var zoomMax = 3.2;

  window.setStatus = function (status) {
    document.querySelectorAll("[data-status]").forEach(function (el) {
      if (el.tagName === "BUTTON") return;
      el.classList.toggle("is-filtered", status !== "all" && el.getAttribute("data-status") !== status);
    });
    document.querySelectorAll(".controls button[data-status]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-status") === status);
    });
  };

  function clearRelated(scope) {
    (scope || document).querySelectorAll(".node,.edge").forEach(function (el) {
      el.classList.remove("is-related-dim");
    });
  }

  function pageKind() {
    var current = document.querySelector('nav a[aria-current="page"]');
    var href = current ? current.getAttribute("href") || "" : location.pathname;
    var name = href.split("/").pop();
    if (/01_alimentazione\.html$/.test(name)) return "alimentazione";
    if (/02_provenienze\.html$/.test(name)) return "provenienze";
    if (/03_insediamento\.html$/.test(name)) return "insediamento";
    if (/04_costruzione\.html$/.test(name)) return "costruzione";
    if (/05_conoscenze\.html$/.test(name)) return "conoscenze";
    return "altro";
  }

  function supportsGraphViewport(kind) {
    return kind === "alimentazione" || kind === "costruzione" || kind === "conoscenze";
  }

  function svgPoint(svg, event) {
    var point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  function currentTransform(svg) {
    return {
      x: Number(svg.dataset.viewX || 0),
      y: Number(svg.dataset.viewY || 0),
      scale: Number(svg.dataset.viewScale || 1)
    };
  }

  function graphLocalPoint(svg, event) {
    var p = svgPoint(svg, event);
    var t = currentTransform(svg);
    return {
      x: (p.x - t.x) / t.scale,
      y: (p.y - t.y) / t.scale
    };
  }

  function getNodeOffset(node) {
    return {
      x: Number(node.dataset.nodeX || 0),
      y: Number(node.dataset.nodeY || 0)
    };
  }

  function setNodeOffset(node, x, y) {
    node.dataset.nodeX = String(x);
    node.dataset.nodeY = String(y);
    node.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
  }

  function setSelectedNode(node) {
    if (selectedNode && selectedNode !== node) selectedNode.classList.remove("is-selected-node");
    selectedNode = node || null;
    if (selectedNode) selectedNode.classList.add("is-selected-node");
  }

  function setSelectedElement(el) {
    if (selectedElement && selectedElement !== el) selectedElement.classList.remove("is-selected-graph-element");
    selectedElement = el || null;
    setSelectedNode(selectedElement && selectedElement.classList.contains("is-draggable-node") ? selectedElement : null);
    if (selectedElement) selectedElement.classList.add("is-selected-graph-element");
    var wrap = selectedElement ? selectedElement.closest(".graph-wrap") : activeGraph;
    if (wrap) {
      refreshEditorPanel(wrap);
      updateEditorActions(wrap);
    }
  }

  function setGrid(wrap, state) {
    var grid = 24 * state.scale;
    wrap.style.setProperty("--graph-grid-size", Math.max(8, Math.min(96, grid)).toFixed(2) + "px");
    wrap.style.setProperty("--graph-grid-x", state.x.toFixed(2) + "px");
    wrap.style.setProperty("--graph-grid-y", state.y.toFixed(2) + "px");
  }

  function applyTransform(svg, wrap) {
    var layer = svg.querySelector(":scope > .graph-panzoom-layer");
    if (!layer) return;
    var state = currentTransform(svg);
    layer.setAttribute("transform", "translate(" + state.x.toFixed(2) + " " + state.y.toFixed(2) + ") scale(" + state.scale.toFixed(4) + ")");
    if (wrap) setGrid(wrap, state);
  }

  function preparePanZoomLayer(svg) {
    if (svg.querySelector(":scope > .graph-panzoom-layer")) return;
    var layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "graph-panzoom-layer");
    Array.from(svg.childNodes).forEach(function (child) {
      if (child.nodeType !== 1) return;
      if (child.tagName && child.tagName.toLowerCase() === "defs") return;
      layer.appendChild(child);
    });
    svg.appendChild(layer);
  }

  function ensureAnnotationLayers(svg) {
    var layer = svg.querySelector(":scope > .graph-panzoom-layer");
    if (!layer) return {};
    var back = layer.querySelector(":scope > .graph-annotation-layer-back");
    var front = layer.querySelector(":scope > .graph-annotation-layer-front");
    if (!back) {
      back = document.createElementNS("http://www.w3.org/2000/svg", "g");
      back.setAttribute("class", "graph-annotation-layer graph-annotation-layer-back");
      layer.insertBefore(back, layer.firstChild);
    }
    if (!front) {
      front = document.createElementNS("http://www.w3.org/2000/svg", "g");
      front.setAttribute("class", "graph-annotation-layer graph-annotation-layer-front");
      layer.appendChild(front);
    }
    return { back: back, front: front };
  }

  function shapeBox(node) {
    var offset = getNodeOffset(node);
    var rect = node.querySelector("rect");
    if (rect) {
      return {
        x: Number(rect.getAttribute("x")) + offset.x,
        y: Number(rect.getAttribute("y")) + offset.y,
        width: Number(rect.getAttribute("width")),
        height: Number(rect.getAttribute("height"))
      };
    }
    var circle = node.querySelector("circle");
    if (circle) {
      var cx = Number(circle.getAttribute("cx")) + offset.x;
      var cy = Number(circle.getAttribute("cy")) + offset.y;
      var r = Number(circle.getAttribute("r"));
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    var box = node.getBBox();
    return { x: box.x + offset.x, y: box.y + offset.y, width: box.width, height: box.height };
  }

  function circleGeometry(node) {
    var circle = node.querySelector("circle");
    if (!circle) return null;
    var offset = getNodeOffset(node);
    return {
      cx: Number(circle.getAttribute("cx")) + offset.x,
      cy: Number(circle.getAttribute("cy")) + offset.y,
      r: Number(circle.getAttribute("r"))
    };
  }

  function rectGeometry(node) {
    var rect = node.querySelector("rect");
    if (!rect) return null;
    var offset = getNodeOffset(node);
    return {
      x: Number(rect.getAttribute("x")) + offset.x,
      y: Number(rect.getAttribute("y")) + offset.y,
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height"))
    };
  }

  function center(box) {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  function rectAnchor(rect, otherPoint) {
    var c = center(rect);
    var dx = otherPoint.x - c.x;
    var dy = otherPoint.y - c.y;
    var halfW = rect.width / 2;
    var halfH = rect.height / 2;
    if (!dx && !dy) return c;
    var scale = Math.min(Math.abs(halfW / (dx || 0.0001)), Math.abs(halfH / (dy || 0.0001)));
    return { x: c.x + dx * scale, y: c.y + dy * scale };
  }

  function circleAnchor(circle, otherPoint, inset) {
    var dx = otherPoint.x - circle.cx;
    var dy = otherPoint.y - circle.cy;
    var distance = Math.hypot(dx, dy) || 1;
    var radius = Math.max(0, circle.r - (inset || 0));
    return {
      x: circle.cx + dx / distance * radius,
      y: circle.cy + dy / distance * radius
    };
  }

  function nodeCenter(node) {
    var circle = circleGeometry(node);
    if (circle) return { x: circle.cx, y: circle.cy };
    return center(shapeBox(node));
  }

  function anchor(box, otherBox) {
    var a = center(box);
    var b = center(otherBox);
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? box.x + box.width : box.x, y: a.y };
    return { x: a.x, y: dy >= 0 ? box.y + box.height : box.y };
  }

  function isFlowBoxGraphKind(kind) {
    return kind === "alimentazione" || kind === "costruzione";
  }

  function flowBoxRoute(source, target) {
    var sourceCenter = center(source);
    var targetCenter = center(target);
    var dx = targetCenter.x - sourceCenter.x;
    var dy = targetCenter.y - sourceCenter.y;
    var horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      return {
        mode: "horizontal",
        start: {
          x: dx >= 0 ? source.x + source.width : source.x,
          y: sourceCenter.y
        },
        end: {
          x: dx >= 0 ? target.x : target.x + target.width,
          y: targetCenter.y
        }
      };
    }
    return {
      mode: "vertical",
      start: {
        x: sourceCenter.x,
        y: dy >= 0 ? source.y + source.height : source.y
      },
      end: {
        x: targetCenter.x,
        y: dy >= 0 ? target.y : target.y + target.height
      }
    };
  }

  function makeFlowBoxPath(source, target, curvature) {
    var route = flowBoxRoute(source, target);
    var start = route.start;
    var end = route.end;
    if (route.mode === "horizontal") {
      var midX = start.x + (end.x - start.x) * (0.5 + (curvature - 1) * 0.08);
      if (curvature <= 0) {
        return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) +
          " L " + midX.toFixed(1) + " " + start.y.toFixed(1) +
          " L " + midX.toFixed(1) + " " + end.y.toFixed(1) +
          " L " + end.x.toFixed(1) + " " + end.y.toFixed(1);
      }
      return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) +
        " C " + midX.toFixed(1) + " " + start.y.toFixed(1) + ", " +
        midX.toFixed(1) + " " + end.y.toFixed(1) + ", " +
        end.x.toFixed(1) + " " + end.y.toFixed(1);
    }
    var midY = start.y + (end.y - start.y) * (0.5 + (curvature - 1) * 0.08);
    if (curvature <= 0) {
      return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) +
        " L " + start.x.toFixed(1) + " " + midY.toFixed(1) +
        " L " + end.x.toFixed(1) + " " + midY.toFixed(1) +
        " L " + end.x.toFixed(1) + " " + end.y.toFixed(1);
    }
    return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) +
      " C " + start.x.toFixed(1) + " " + midY.toFixed(1) + ", " +
      end.x.toFixed(1) + " " + midY.toFixed(1) + ", " +
      end.x.toFixed(1) + " " + end.y.toFixed(1);
  }

  function nodeAnchor(node, otherNode, kind, isEnd) {
    var otherPoint = nodeCenter(otherNode);
    var circle = circleGeometry(node);
    if (kind === "conoscenze" && circle) {
      return circleAnchor(circle, otherPoint, isEnd ? 1.2 : 0);
    }
    var rect = rectGeometry(node);
    if (rect) return rectAnchor(rect, otherPoint);
    if (circle) return circleAnchor(circle, otherPoint, isEnd ? 1 : 0);
    return anchor(shapeBox(node), shapeBox(otherNode));
  }

  function polarPoint(centerPoint, angle, radius) {
    return {
      x: centerPoint.x + Math.cos(angle) * radius,
      y: centerPoint.y + Math.sin(angle) * radius
    };
  }

  function angleDelta(a, b) {
    var delta = b - a;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function makeKnowledgePath(svg, sourceNode, targetNode, start, end, curvature) {
    if (curvature <= 0) {
      return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) + " L " + end.x.toFixed(1) + " " + end.y.toFixed(1);
    }
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var origin = vb ? { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 } : center(shapeBox(sourceNode));
    var sourceCenter = nodeCenter(sourceNode);
    var targetCenter = nodeCenter(targetNode);
    var startAngle = Math.atan2(sourceCenter.y - origin.y, sourceCenter.x - origin.x);
    var endAngle = Math.atan2(targetCenter.y - origin.y, targetCenter.x - origin.x);
    if (Math.hypot(sourceCenter.x - origin.x, sourceCenter.y - origin.y) < 2) {
      startAngle = endAngle;
    }
    var delta = angleDelta(startAngle, endAngle);
    var startRadius = Math.hypot(start.x - origin.x, start.y - origin.y);
    var endRadius = Math.hypot(end.x - origin.x, end.y - origin.y);
    var radiusDelta = endRadius - startRadius;
    var c1 = polarPoint(origin, startAngle + delta * 0.28 * curvature, startRadius + radiusDelta * 0.42);
    var c2 = polarPoint(origin, startAngle + delta * 0.78 * curvature, startRadius + radiusDelta * 0.78);
    return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) +
      " C " + c1.x.toFixed(1) + " " + c1.y.toFixed(1) + ", " +
      c2.x.toFixed(1) + " " + c2.y.toFixed(1) + ", " +
      end.x.toFixed(1) + " " + end.y.toFixed(1);
  }

  function makeEdgePath(svg, sourceNode, targetNode, kind, edge) {
    var curvature = edge ? Number(edge.dataset.curvature || 1) : 1;
    if (kind === "conoscenze" || svg.classList.contains("knowledge-radial")) {
      var kStart = nodeAnchor(sourceNode, targetNode, "conoscenze", false);
      var kEnd = nodeAnchor(targetNode, sourceNode, "conoscenze", true);
      return makeKnowledgePath(svg, sourceNode, targetNode, kStart, kEnd, curvature);
    }

    var source = shapeBox(sourceNode);
    var target = shapeBox(targetNode);
    if (isFlowBoxGraphKind(kind) && rectGeometry(sourceNode) && rectGeometry(targetNode)) {
      return makeFlowBoxPath(source, target, curvature);
    }
    var start = anchor(source, target);
    var end = anchor(target, source);
    var dx = end.x - start.x;
    var dy = end.y - start.y;
    if (curvature <= 0) return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) + " L " + end.x.toFixed(1) + " " + end.y.toFixed(1);
    if (Math.abs(dx) >= Math.abs(dy)) {
      var midX = start.x + dx * (0.5 + (curvature - 1) * 0.08);
      return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) + " C " + midX.toFixed(1) + " " + start.y.toFixed(1) + ", " + midX.toFixed(1) + " " + end.y.toFixed(1) + ", " + end.x.toFixed(1) + " " + end.y.toFixed(1);
    }
    var midY = start.y + dy * (0.5 + (curvature - 1) * 0.08);
    return "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) + " C " + start.x.toFixed(1) + " " + midY.toFixed(1) + ", " + end.x.toFixed(1) + " " + midY.toFixed(1) + ", " + end.x.toFixed(1) + " " + end.y.toFixed(1);
  }

  function escapeSelectorId(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/(["'\\.#:[\],>+~*^$|=])/g, "\\$1");
  }

  function updateEdges(svg, kind, onlyId) {
    svg.querySelectorAll(".edge[data-source][data-target]").forEach(function (edge) {
      if (onlyId && edge.getAttribute("data-source") !== onlyId && edge.getAttribute("data-target") !== onlyId) return;
      var source = svg.querySelector('.node[data-id="' + escapeSelectorId(edge.getAttribute("data-source")) + '"]');
      var target = svg.querySelector('.node[data-id="' + escapeSelectorId(edge.getAttribute("data-target")) + '"]');
      if (!source || !target) return;
      edge.setAttribute("d", makeEdgePath(svg, source, target, kind, edge));
    });
  }

  function tuneSvg(svg) {
    svg.querySelectorAll("marker[id]").forEach(function (marker) {
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto-start-reverse");
      marker.setAttribute("markerUnits", "strokeWidth");
      var path = marker.querySelector("path");
      if (path) {
        path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
        path.setAttribute("fill", "context-stroke");
      }
    });
  }

  function editorAllowed(kind) {
    return kind === "alimentazione" || kind === "costruzione" || kind === "conoscenze";
  }

  function svgElementId(el) {
    if (!el) return "";
    if (el.classList.contains("graph-annotation")) return "annotation:" + (el.getAttribute("data-id") || "");
    if (el.classList.contains("edge")) {
      return "edge:" + (el.getAttribute("data-source") || "") + ">" + (el.getAttribute("data-target") || "");
    }
    return "element:" + (el.getAttribute("data-id") || "");
  }

  function primaryShape(el) {
    if (!el) return null;
    if (el.classList.contains("edge")) return el;
    return el.querySelector("rect,circle,image");
  }

  function textNodes(el) {
    return el ? Array.from(el.querySelectorAll("text")) : [];
  }

  function storeOriginals(svg) {
    svg.querySelectorAll(".node[data-id],.graph-heading[data-id],.edge[data-source][data-target]").forEach(function (el) {
      if (el.dataset.editorOriginal) return;
      var shape = primaryShape(el);
      el.dataset.editorOriginal = JSON.stringify({
        transform: el.getAttribute("transform") || "",
        nodeX: el.dataset.nodeX || "",
        nodeY: el.dataset.nodeY || "",
        curvature: el.dataset.curvature || "",
        attrs: shape ? {
          fill: shape.getAttribute("fill"),
          stroke: shape.getAttribute("stroke"),
          strokeWidth: shape.getAttribute("stroke-width"),
          opacity: shape.getAttribute("opacity"),
          width: shape.getAttribute("width"),
          height: shape.getAttribute("height"),
          r: shape.getAttribute("r"),
          strokeDasharray: shape.getAttribute("stroke-dasharray"),
          markerWidth: shape.getAttribute("markerWidth")
        } : {},
        text: textNodes(el).map(function (text) {
          return {
            fontSize: text.getAttribute("font-size"),
            fontWeight: text.getAttribute("font-weight"),
            textAnchor: text.getAttribute("text-anchor"),
            fill: text.getAttribute("fill")
          };
        })
      });
    });
  }

  function graphElements(svg) {
    return Array.from(svg.querySelectorAll(".node[data-id],.graph-heading[data-id],.edge[data-source][data-target],.graph-annotation[data-id]"));
  }

  function snapshotGraph(wrap) {
    var svg = wrap.querySelector("svg");
    var layers = ensureAnnotationLayers(svg);
    var state = {
      view: currentTransform(svg),
      elements: {},
      annotations: {
        back: layers.back ? layers.back.innerHTML : "",
        front: layers.front ? layers.front.innerHTML : ""
      }
    };
    graphElements(svg).forEach(function (el) {
      var shape = primaryShape(el);
      state.elements[svgElementId(el)] = {
        nodeX: el.dataset.nodeX || "",
        nodeY: el.dataset.nodeY || "",
        transform: el.getAttribute("transform") || "",
        curvature: el.dataset.curvature || "",
        shape: shape ? {
          fill: shape.getAttribute("fill") || "",
          stroke: shape.getAttribute("stroke") || "",
          strokeWidth: shape.getAttribute("stroke-width") || "",
          opacity: shape.getAttribute("opacity") || "",
          width: shape.getAttribute("width") || "",
          height: shape.getAttribute("height") || "",
          r: shape.getAttribute("r") || "",
          strokeDasharray: shape.getAttribute("stroke-dasharray") || ""
        } : {},
        text: textNodes(el).map(function (text) {
          return {
            fontSize: text.getAttribute("font-size") || "",
            fontWeight: text.getAttribute("font-weight") || "",
            textAnchor: text.getAttribute("text-anchor") || "",
            fill: text.getAttribute("fill") || ""
          };
        })
      };
    });
    return state;
  }

  function saveLocalGraphConfig(wrap) {
    var editor = graphEditors.get(wrap);
    if (!editor) return;
    try {
      localStorage.setItem("graph-editor-" + location.pathname + "-" + editor.kind, JSON.stringify(snapshotGraph(wrap)));
    } catch (error) {}
  }

  function loadLocalGraphConfig(wrap) {
    var editor = graphEditors.get(wrap);
    if (!editor) return;
    try {
      var raw = localStorage.getItem("graph-editor-" + location.pathname + "-" + editor.kind);
      if (raw) applyGraphSnapshot(wrap, JSON.parse(raw));
    } catch (error) {}
  }

  function setOrRemoveAttr(el, name, value) {
    if (!el) return;
    if (value === null || value === undefined || value === "") el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function applyGraphSnapshot(wrap, state) {
    var svg = wrap.querySelector("svg");
    if (!svg || !state) return;
    var layers = ensureAnnotationLayers(svg);
    if (state.annotations) {
      if (layers.back) layers.back.innerHTML = state.annotations.back || "";
      if (layers.front) layers.front.innerHTML = state.annotations.front || "";
      bindAnnotations(wrap, svg);
    }
    if (state.view) {
      svg.dataset.viewX = String(state.view.x || 0);
      svg.dataset.viewY = String(state.view.y || 0);
      svg.dataset.viewScale = String(state.view.scale || 1);
      applyTransform(svg, wrap);
    }
    graphElements(svg).forEach(function (el) {
      var data = state.elements && state.elements[svgElementId(el)];
      if (!data) return;
      el.dataset.nodeX = data.nodeX || "";
      el.dataset.nodeY = data.nodeY || "";
      if (data.transform) el.setAttribute("transform", data.transform);
      else el.removeAttribute("transform");
      if (data.curvature) el.dataset.curvature = data.curvature;
      else delete el.dataset.curvature;
      var shape = primaryShape(el);
      if (shape && data.shape) {
        setOrRemoveAttr(shape, "fill", data.shape.fill);
        setOrRemoveAttr(shape, "stroke", data.shape.stroke);
        setOrRemoveAttr(shape, "stroke-width", data.shape.strokeWidth);
        setOrRemoveAttr(shape, "opacity", data.shape.opacity);
        setOrRemoveAttr(shape, "width", data.shape.width);
        setOrRemoveAttr(shape, "height", data.shape.height);
        setOrRemoveAttr(shape, "r", data.shape.r);
        setOrRemoveAttr(shape, "stroke-dasharray", data.shape.strokeDasharray);
      }
      textNodes(el).forEach(function (text, index) {
        var textData = data.text && data.text[index];
        if (!textData) return;
        setOrRemoveAttr(text, "font-size", textData.fontSize);
        setOrRemoveAttr(text, "font-weight", textData.fontWeight);
        setOrRemoveAttr(text, "text-anchor", textData.textAnchor);
        setOrRemoveAttr(text, "fill", textData.fill);
      });
    });
    updateEdges(svg, pageKind());
    refreshEditorPanel(wrap);
  }

  function pushEditorHistory(wrap) {
    var editor = graphEditors.get(wrap);
    if (!editor || editor.silent) return;
    editor.undo.push(snapshotGraph(wrap));
    if (editor.undo.length > 60) editor.undo.shift();
    editor.redo = [];
    updateEditorActions(wrap);
  }

  function runWithSnapshot(wrap, action) {
    pushEditorHistory(wrap);
    action();
    refreshEditorPanel(wrap);
    saveLocalGraphConfig(wrap);
    updateEditorActions(wrap);
  }

  function resetGraph(wrap) {
    var svg = wrap.querySelector("svg");
    graphElements(svg).forEach(function (el) {
      if (el.classList.contains("graph-annotation")) return;
      var original;
      try { original = JSON.parse(el.dataset.editorOriginal || "{}"); } catch (error) { original = {}; }
      el.dataset.nodeX = original.nodeX || "";
      el.dataset.nodeY = original.nodeY || "";
      delete el.dataset.curvature;
      if (original.transform) el.setAttribute("transform", original.transform);
      else el.removeAttribute("transform");
      var shape = primaryShape(el);
      if (shape && original.attrs) {
        setOrRemoveAttr(shape, "fill", original.attrs.fill);
        setOrRemoveAttr(shape, "stroke", original.attrs.stroke);
        setOrRemoveAttr(shape, "stroke-width", original.attrs.strokeWidth);
        setOrRemoveAttr(shape, "opacity", original.attrs.opacity);
        setOrRemoveAttr(shape, "width", original.attrs.width);
        setOrRemoveAttr(shape, "height", original.attrs.height);
        setOrRemoveAttr(shape, "r", original.attrs.r);
        setOrRemoveAttr(shape, "stroke-dasharray", original.attrs.strokeDasharray);
      }
      textNodes(el).forEach(function (text, index) {
        var textData = original.text && original.text[index];
        if (!textData) return;
        setOrRemoveAttr(text, "font-size", textData.fontSize);
        setOrRemoveAttr(text, "font-weight", textData.fontWeight);
        setOrRemoveAttr(text, "text-anchor", textData.textAnchor);
        setOrRemoveAttr(text, "fill", textData.fill);
      });
    });
    var layers = ensureAnnotationLayers(svg);
    if (layers.back) layers.back.innerHTML = "";
    if (layers.front) layers.front.innerHTML = "";
    setSelectedElement(null);
    updateEdges(svg, pageKind());
  }

  function resetAnnotation(annotation) {
    var shape = annotationShape(annotation);
    if (!shape) return;
    annotation.dataset.locked = "0";
    shape.removeAttribute("stroke-dasharray");
    shape.setAttribute("stroke", "#8b6f35");
    shape.setAttribute("stroke-width", "2");
    shape.setAttribute("stroke-opacity", "1");
    if (shape.tagName.toLowerCase() === "rect") {
      shape.setAttribute("fill", "#f6d77a");
      shape.setAttribute("fill-opacity", "0.18");
      shape.setAttribute("rx", "4");
      shape.setAttribute("ry", "4");
    } else {
      shape.setAttribute("opacity", "0.9");
    }
    updateAnnotationHandles(annotation);
  }

  function resetElement(wrap, el) {
    if (!el) return;
    var svg = wrap.querySelector("svg");
    var original;
    try { original = JSON.parse(el.dataset.editorOriginal || "{}"); } catch (error) { original = {}; }
    el.dataset.nodeX = original.nodeX || "";
    el.dataset.nodeY = original.nodeY || "";
    delete el.dataset.curvature;
    if (original.transform) el.setAttribute("transform", original.transform);
    else el.removeAttribute("transform");
    var shape = primaryShape(el);
    if (shape && original.attrs) {
      setOrRemoveAttr(shape, "fill", original.attrs.fill);
      setOrRemoveAttr(shape, "stroke", original.attrs.stroke);
      setOrRemoveAttr(shape, "stroke-width", original.attrs.strokeWidth);
      setOrRemoveAttr(shape, "opacity", original.attrs.opacity);
      setOrRemoveAttr(shape, "width", original.attrs.width);
      setOrRemoveAttr(shape, "height", original.attrs.height);
      setOrRemoveAttr(shape, "r", original.attrs.r);
      setOrRemoveAttr(shape, "stroke-dasharray", original.attrs.strokeDasharray);
    }
    textNodes(el).forEach(function (text, index) {
      var textData = original.text && original.text[index];
      if (!textData) return;
      setOrRemoveAttr(text, "font-size", textData.fontSize);
      setOrRemoveAttr(text, "font-weight", textData.fontWeight);
      setOrRemoveAttr(text, "text-anchor", textData.textAnchor);
      setOrRemoveAttr(text, "fill", textData.fill);
    });
    updateEdges(svg, pageKind(), el.getAttribute("data-id"));
  }

  function resetView(wrap) {
    var svg = wrap.querySelector("svg");
    svg.dataset.viewX = "0";
    svg.dataset.viewY = "0";
    svg.dataset.viewScale = "1";
    applyTransform(svg, wrap);
  }

  function nextAnnotationId() {
    return "ann-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 10000).toString(36);
  }

  function annotationShape(annotation) {
    return annotation ? annotation.querySelector("rect,image") : null;
  }

  function annotationBounds(annotation) {
    var shape = annotationShape(annotation);
    if (!shape) return { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: Number(shape.getAttribute("x") || 0),
      y: Number(shape.getAttribute("y") || 0),
      width: Number(shape.getAttribute("width") || 0),
      height: Number(shape.getAttribute("height") || 0)
    };
  }

  function updateAnnotationHandles(annotation) {
    var bounds = annotationBounds(annotation);
    annotation.querySelectorAll(".graph-annotation-handle").forEach(function (handle) {
      var pos = handle.getAttribute("data-handle");
      var x = pos.indexOf("w") >= 0 ? bounds.x : bounds.x + bounds.width;
      var y = pos.indexOf("n") >= 0 ? bounds.y : bounds.y + bounds.height;
      handle.setAttribute("cx", x.toFixed(1));
      handle.setAttribute("cy", y.toFixed(1));
    });
  }

  function addAnnotationHandles(annotation) {
    ["nw", "ne", "sw", "se"].forEach(function (pos) {
      if (annotation.querySelector('.graph-annotation-handle[data-handle="' + pos + '"]')) return;
      var handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      handle.setAttribute("class", "graph-annotation-handle");
      handle.setAttribute("data-handle", pos);
      handle.setAttribute("r", "5");
      annotation.appendChild(handle);
    });
    updateAnnotationHandles(annotation);
  }

  function createBoxAnnotation(wrap, svg, bounds) {
    var layers = ensureAnnotationLayers(svg);
    var group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "graph-annotation graph-annotation-box");
    group.setAttribute("data-id", nextAnnotationId());
    group.setAttribute("tabindex", "0");
    var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", bounds.x.toFixed(1));
    rect.setAttribute("y", bounds.y.toFixed(1));
    rect.setAttribute("width", Math.max(6, bounds.width).toFixed(1));
    rect.setAttribute("height", Math.max(6, bounds.height).toFixed(1));
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", "#f6d77a");
    rect.setAttribute("fill-opacity", "0.18");
    rect.setAttribute("stroke", "#8b6f35");
    rect.setAttribute("stroke-width", "2");
    group.appendChild(rect);
    addAnnotationHandles(group);
    (layers.back || layers.front).appendChild(group);
    bindAnnotation(wrap, svg, group);
    setSelectedElement(group);
    return group;
  }

  function createImageAnnotation(wrap, svg, href) {
    var vb = svg.viewBox.baseVal;
    var layers = ensureAnnotationLayers(svg);
    var group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "graph-annotation graph-annotation-image");
    group.setAttribute("data-id", nextAnnotationId());
    group.setAttribute("tabindex", "0");
    var image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("href", href);
    image.setAttribute("x", (vb.x + vb.width * 0.36).toFixed(1));
    image.setAttribute("y", (vb.y + vb.height * 0.36).toFixed(1));
    image.setAttribute("width", Math.max(120, vb.width * 0.14).toFixed(1));
    image.setAttribute("height", Math.max(90, vb.height * 0.12).toFixed(1));
    image.setAttribute("opacity", "0.9");
    group.appendChild(image);
    addAnnotationHandles(group);
    (layers.front || layers.back).appendChild(group);
    bindAnnotation(wrap, svg, group);
    setSelectedElement(group);
    return group;
  }

  function moveAnnotation(annotation, dx, dy) {
    var shape = annotationShape(annotation);
    if (!shape) return;
    shape.setAttribute("x", (Number(shape.getAttribute("x") || 0) + dx).toFixed(1));
    shape.setAttribute("y", (Number(shape.getAttribute("y") || 0) + dy).toFixed(1));
    updateAnnotationHandles(annotation);
  }

  function resizeAnnotation(annotation, handle, point, keepRatio) {
    var shape = annotationShape(annotation);
    if (!shape || !annotationDragState) return;
    var b = annotationDragState.baseBounds;
    var x1 = b.x;
    var y1 = b.y;
    var x2 = b.x + b.width;
    var y2 = b.y + b.height;
    if (handle.indexOf("w") >= 0) x1 = point.x;
    if (handle.indexOf("e") >= 0) x2 = point.x;
    if (handle.indexOf("n") >= 0) y1 = point.y;
    if (handle.indexOf("s") >= 0) y2 = point.y;
    var x = Math.min(x1, x2);
    var y = Math.min(y1, y2);
    var width = Math.max(8, Math.abs(x2 - x1));
    var height = Math.max(8, Math.abs(y2 - y1));
    if (keepRatio && b.height) {
      var ratio = b.width / b.height;
      if (width / height > ratio) width = height * ratio;
      else height = width / ratio;
      if (handle.indexOf("w") >= 0) x = b.x + b.width - width;
      if (handle.indexOf("n") >= 0) y = b.y + b.height - height;
    }
    shape.setAttribute("x", x.toFixed(1));
    shape.setAttribute("y", y.toFixed(1));
    shape.setAttribute("width", width.toFixed(1));
    shape.setAttribute("height", height.toFixed(1));
    updateAnnotationHandles(annotation);
  }

  function bindAnnotation(wrap, svg, annotation) {
    if (annotation.dataset.bound === "1") return;
    annotation.dataset.bound = "1";
    addAnnotationHandles(annotation);
    annotation.addEventListener("pointerdown", function (event) {
      var editor = graphEditors.get(wrap);
      if (!editor || !editor.enabled || editor.mode !== "select") return;
      if (annotation.dataset.locked === "1" && !editor.showLocked) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      activeGraph = wrap;
      setSelectedElement(annotation);
      if (annotation.dataset.locked === "1") return;
      pushEditorHistory(wrap);
      var point = graphLocalPoint(svg, event);
      var handle = event.target.closest ? event.target.closest(".graph-annotation-handle") : null;
      annotationDragState = {
        wrap: wrap,
        svg: svg,
        annotation: annotation,
        pointerId: event.pointerId,
        start: point,
        mode: handle ? "resize" : "move",
        handle: handle ? handle.getAttribute("data-handle") : "",
        baseBounds: annotationBounds(annotation)
      };
      annotation.setPointerCapture(event.pointerId);
    });
    annotation.addEventListener("pointermove", function (event) {
      if (!annotationDragState || annotationDragState.annotation !== annotation || annotationDragState.pointerId !== event.pointerId) return;
      event.preventDefault();
      var point = graphLocalPoint(svg, event);
      if (annotationDragState.mode === "resize") resizeAnnotation(annotation, annotationDragState.handle, point, event.shiftKey);
      else moveAnnotation(annotation, point.x - annotationDragState.start.x, point.y - annotationDragState.start.y);
      annotationDragState.start = point;
      refreshEditorPanel(wrap);
    });
    function endAnnotationDrag(event) {
      if (!annotationDragState || annotationDragState.annotation !== annotation) return;
      if (event && event.pointerId !== undefined && event.pointerId !== annotationDragState.pointerId) return;
      try { annotation.releasePointerCapture(annotationDragState.pointerId); } catch (error) {}
      saveLocalGraphConfig(wrap);
      updateEditorActions(wrap);
      annotationDragState = null;
    }
    annotation.addEventListener("pointerup", endAnnotationDrag);
    annotation.addEventListener("pointercancel", endAnnotationDrag);
  }

  function bindAnnotations(wrap, svg) {
    svg.querySelectorAll(".graph-annotation").forEach(function (annotation) {
      delete annotation.dataset.bound;
      bindAnnotation(wrap, svg, annotation);
    });
  }

  function makeEditorButton(label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function makeEditorMenu(label) {
    var details = document.createElement("details");
    details.className = "graph-editor-menu";
    var summary = document.createElement("summary");
    summary.textContent = label;
    var content = document.createElement("div");
    content.className = "graph-editor-menu-content";
    details.appendChild(summary);
    details.appendChild(content);
    details.addEventListener("toggle", function () {
      var wrap = details.closest(".graph-wrap");
      var editor = wrap ? graphEditors.get(wrap) : null;
      if (details.open && editor && !editor.enabled) details.removeAttribute("open");
    });
    summary.addEventListener("click", function (event) {
      var wrap = details.closest(".graph-wrap");
      var editor = wrap ? graphEditors.get(wrap) : null;
      if (editor && !editor.enabled) {
        event.preventDefault();
        details.removeAttribute("open");
      }
    });
    return { details: details, content: content };
  }

  function markAction(button, key) {
    button.setAttribute("data-editor-action", key);
    return button;
  }

  function updateEditorActions(wrap) {
    var editor = graphEditors.get(wrap);
    if (!editor || !editor.toolbar) return;
    var enabled = !!editor.enabled;
    var selected = selectedElement && selectedElement.closest(".graph-wrap") === wrap ? selectedElement : null;
    var isAnnotation = !!(selected && selected.classList.contains("graph-annotation"));
    var isLocked = isAnnotation && selected.dataset.locked === "1";
    var states = {
      undo: editor.undo.length > 0,
      redo: editor.redo.length > 0,
      selected: !!selected,
      nonAnnotation: !!(selected && !selected.classList.contains("graph-annotation")),
      annotation: isAnnotation,
      unlockedAnnotation: isAnnotation && !isLocked,
      lockedAnnotation: isAnnotation && isLocked
    };
    editor.toolbar.querySelectorAll("button").forEach(function (button) {
      if (button.textContent === "Modifica grafico") return;
      button.disabled = !enabled;
    });
    editor.toolbar.querySelectorAll(".graph-editor-menu").forEach(function (details) {
      var summary = details.querySelector("summary");
      details.classList.toggle("is-disabled", !enabled);
      if (!enabled) details.removeAttribute("open");
      if (summary) {
        summary.setAttribute("aria-disabled", enabled ? "false" : "true");
        summary.tabIndex = enabled ? 0 : -1;
      }
    });
    if (!enabled) return;
    editor.toolbar.querySelectorAll("[data-editor-requires]").forEach(function (button) {
      button.disabled = !states[button.getAttribute("data-editor-requires")];
    });
    editor.toolbar.querySelectorAll("[data-graph-mode]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-graph-mode") === editor.mode);
    });
    editor.toolbar.querySelectorAll("[data-editor-toggle]").forEach(function (button) {
      var key = button.getAttribute("data-editor-toggle");
      var active = key === "grid" ? !wrap.classList.contains("hide-graph-grid") : key === "locked" ? !!editor.showLocked : false;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function makeField(label, input) {
    var field = document.createElement("label");
    field.className = "graph-editor-field";
    var span = document.createElement("span");
    span.textContent = label;
    field.appendChild(span);
    field.appendChild(input);
    return field;
  }

  function makeInput(type, value, onInput, attrs) {
    var input = document.createElement("input");
    input.type = type;
    Object.keys(attrs || {}).forEach(function (key) { input.setAttribute(key, attrs[key]); });
    input.value = value;
    input.addEventListener("input", function () { onInput(input.value); });
    return input;
  }

  function makeSelect(value, options, onInput) {
    var select = document.createElement("select");
    options.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item[0];
      option.textContent = item[1];
      select.appendChild(option);
    });
    select.value = value;
    select.addEventListener("input", function () { onInput(select.value); });
    return select;
  }

  function cssColor(value, fallback) {
    if (!value || value.indexOf("var(") === 0 || value === "context-stroke") return fallback || "#2f4a40";
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return "#" + value.slice(1).split("").map(function (ch) { return ch + ch; }).join("");
    }
    return value;
  }

  function refreshEditorPanel(wrap) {
    var editor = graphEditors.get(wrap);
    if (!editor || !editor.panel) return;
    var panel = editor.panel;
    var svg = wrap.querySelector("svg");
    var el = selectedElement && selectedElement.closest(".graph-wrap") === wrap ? selectedElement : null;
    var shape = primaryShape(el);
    var isEdge = !!(el && el.classList.contains("edge"));
    editor.selectedLabel.textContent = el ? (isAnnotation ? "Annotazione" : isEdge ? "Connessione" : el.classList.contains("graph-heading") ? "Intestazione" : "Nodo") : "Nessun elemento";
    editor.selectedId.textContent = el ? svgElementId(el).replace(/^(edge|element):/, "") : "Seleziona un elemento nel grafico.";
    [editor.textControls, editor.appearanceControls, editor.lineControls, editor.marginControls, editor.fillControls, editor.geometryControls, editor.lockControls].forEach(function (container) {
      if (container) container.innerHTML = "";
    });
    if (!el) return;
    var isAnnotation = el.classList.contains("graph-annotation");

    if (isAnnotation) {
      var annShape = annotationShape(el);
      var annBounds = annotationBounds(el);
      if (annShape) {
        editor.marginControls.appendChild(makeField("Linea", makeInput("color", cssColor(annShape.getAttribute("stroke"), "#8b6f35"), function (value) {
          runWithSnapshot(wrap, function () { annShape.setAttribute("stroke", value); });
        })));
        editor.marginControls.appendChild(makeField("Spessore", makeInput("number", annShape.getAttribute("stroke-width") || "2", function (value) {
          runWithSnapshot(wrap, function () { annShape.setAttribute("stroke-width", Math.max(0, Math.min(12, Number(value) || 0)).toString()); });
        }, { min: "0", max: "12", step: "0.5" })));
        editor.marginControls.appendChild(makeField("Opacita linea", makeInput("range", annShape.getAttribute("stroke-opacity") || "1", function (value) {
          runWithSnapshot(wrap, function () { annShape.setAttribute("stroke-opacity", Math.max(0, Math.min(1, Number(value) || 0)).toString()); });
        }, { min: "0", max: "1", step: "0.05" })));
        editor.marginControls.appendChild(makeField("Stile", makeSelect(annShape.getAttribute("stroke") === "none" ? "none" : annShape.getAttribute("stroke-dasharray") === "2 5" ? "dot" : annShape.getAttribute("stroke-dasharray") ? "dash" : "solid", [["solid", "Continuo"], ["dash", "Tratteggiato"], ["dot", "Puntinato"], ["none", "Nessun bordo"]], function (value) {
          runWithSnapshot(wrap, function () {
            if (value === "none") annShape.setAttribute("stroke", "none");
            else if (value === "dot") { annShape.setAttribute("stroke", cssColor(annShape.getAttribute("stroke"), "#8b6f35")); annShape.setAttribute("stroke-dasharray", "2 5"); }
            else if (value === "dash") { annShape.setAttribute("stroke", cssColor(annShape.getAttribute("stroke"), "#8b6f35")); annShape.setAttribute("stroke-dasharray", "8 5"); }
            else { annShape.setAttribute("stroke", cssColor(annShape.getAttribute("stroke"), "#8b6f35")); annShape.removeAttribute("stroke-dasharray"); }
          });
        })));
        if (annShape.tagName.toLowerCase() === "rect") {
          var maxFillet = Math.floor(Math.min(annBounds.width, annBounds.height) / 2);
          var filletValue = annShape.getAttribute("rx") || "0";
          function setFillet(value) {
            var fillet = Math.max(0, Math.min(maxFillet, Number(value) || 0));
            annShape.setAttribute("rx", String(fillet));
            annShape.setAttribute("ry", String(fillet));
          }
          editor.marginControls.appendChild(makeField("Fillet", makeInput("range", filletValue, function (value) {
            runWithSnapshot(wrap, function () { setFillet(value); });
          }, { min: "0", max: String(maxFillet), step: "1" })));
          editor.marginControls.appendChild(makeField("Fillet valore", makeInput("number", filletValue, function (value) {
            runWithSnapshot(wrap, function () { setFillet(value); });
          }, { min: "0", max: String(maxFillet), step: "1" })));
        }

        editor.fillControls.appendChild(makeField("Campitura", makeInput("color", cssColor(annShape.getAttribute("fill"), "#f6d77a"), function (value) {
          runWithSnapshot(wrap, function () { annShape.setAttribute("fill", value); });
        })));
        editor.fillControls.appendChild(makeField("Opacita campitura", makeInput("range", annShape.getAttribute("fill-opacity") || annShape.getAttribute("opacity") || "0.18", function (value) {
          runWithSnapshot(wrap, function () { annShape.setAttribute(annShape.tagName.toLowerCase() === "image" ? "opacity" : "fill-opacity", Math.max(0, Math.min(1, Number(value) || 0)).toString()); });
        }, { min: "0", max: "1", step: "0.05" })));
        editor.fillControls.appendChild(makeField("Riempimento", makeSelect(annShape.getAttribute("fill") === "none" ? "none" : "fill", [["fill", "Visibile"], ["none", "Trasparente"]], function (value) {
          runWithSnapshot(wrap, function () { annShape.setAttribute("fill", value === "none" ? "none" : cssColor(annShape.getAttribute("fill"), "#f6d77a")); });
        })));

        function setAnnotationNumber(attr, value) {
          annShape.setAttribute(attr, Math.max(attr === "x" || attr === "y" ? -10000 : 1, Number(value) || 0).toFixed(1));
          updateAnnotationHandles(el);
        }
        editor.geometryControls.appendChild(makeField("X", makeInput("number", String(annBounds.x), function (value) { runWithSnapshot(wrap, function () { setAnnotationNumber("x", value); }); }, { step: "1" })));
        editor.geometryControls.appendChild(makeField("Y", makeInput("number", String(annBounds.y), function (value) { runWithSnapshot(wrap, function () { setAnnotationNumber("y", value); }); }, { step: "1" })));
        editor.geometryControls.appendChild(makeField("Larghezza", makeInput("number", String(annBounds.width), function (value) { runWithSnapshot(wrap, function () { setAnnotationNumber("width", value); }); }, { min: "1", step: "1" })));
        editor.geometryControls.appendChild(makeField("Altezza", makeInput("number", String(annBounds.height), function (value) { runWithSnapshot(wrap, function () { setAnnotationNumber("height", value); }); }, { min: "1", step: "1" })));
      }
      editor.lockControls.appendChild(makeEditorButton(el.dataset.locked === "1" ? "Sblocca elemento" : "Blocca elemento", function () {
        runWithSnapshot(wrap, function () { el.dataset.locked = el.dataset.locked === "1" ? "0" : "1"; });
      }));
      return;
    }

    if (shape) {
      editor.appearanceControls.appendChild(makeEditorButton("Ripristina elemento", function () {
        runWithSnapshot(wrap, function () { resetElement(wrap, el); });
      }));
      editor.appearanceControls.appendChild(makeField("Riempimento", makeInput("color", cssColor(shape.getAttribute("fill"), "#ffffff"), function (value) {
        runWithSnapshot(wrap, function () { if (!isEdge) shape.setAttribute("fill", value); });
      })));
      editor.appearanceControls.appendChild(makeField("Bordo / linea", makeInput("color", cssColor(shape.getAttribute("stroke"), "#2f4a40"), function (value) {
        runWithSnapshot(wrap, function () { shape.setAttribute("stroke", value); });
      })));
      editor.appearanceControls.appendChild(makeField("Spessore", makeInput("number", shape.getAttribute("stroke-width") || "1.7", function (value) {
        runWithSnapshot(wrap, function () { shape.setAttribute("stroke-width", Math.max(0.5, Math.min(12, Number(value) || 1)).toString()); });
      }, { min: "0.5", max: "12", step: "0.5" })));
      editor.appearanceControls.appendChild(makeField("Opacita", makeInput("range", shape.getAttribute("opacity") || "1", function (value) {
        runWithSnapshot(wrap, function () { shape.setAttribute("opacity", Math.max(0.05, Math.min(1, Number(value) || 1)).toString()); });
      }, { min: "0.05", max: "1", step: "0.05" })));
      if (shape.tagName.toLowerCase() === "rect") {
        editor.appearanceControls.appendChild(makeField("Larghezza", makeInput("number", shape.getAttribute("width") || "", function (value) {
          runWithSnapshot(wrap, function () { shape.setAttribute("width", Math.max(30, Number(value) || 30).toString()); updateEdges(wrap.querySelector("svg"), pageKind(), el.getAttribute("data-id")); });
        }, { min: "30", step: "5" })));
        editor.appearanceControls.appendChild(makeField("Altezza", makeInput("number", shape.getAttribute("height") || "", function (value) {
          runWithSnapshot(wrap, function () { shape.setAttribute("height", Math.max(20, Number(value) || 20).toString()); updateEdges(wrap.querySelector("svg"), pageKind(), el.getAttribute("data-id")); });
        }, { min: "20", step: "5" })));
      }
      if (shape.tagName.toLowerCase() === "circle") {
        editor.appearanceControls.appendChild(makeField("Raggio", makeInput("number", shape.getAttribute("r") || "", function (value) {
          runWithSnapshot(wrap, function () { shape.setAttribute("r", Math.max(3, Math.min(120, Number(value) || 3)).toString()); updateEdges(wrap.querySelector("svg"), pageKind(), el.getAttribute("data-id")); });
        }, { min: "3", max: "120", step: "1" })));
      }
    }

    var firstText = textNodes(el)[0];
    if (firstText) {
      editor.textControls.appendChild(makeField("Testo colore", makeInput("color", cssColor(firstText.getAttribute("fill"), "#202624"), function (value) {
        runWithSnapshot(wrap, function () { textNodes(el).forEach(function (text) { text.setAttribute("fill", value); }); });
      })));
      editor.textControls.appendChild(makeField("Testo px", makeInput("number", firstText.getAttribute("font-size") || "12", function (value) {
        runWithSnapshot(wrap, function () { textNodes(el).forEach(function (text) { text.setAttribute("font-size", Math.max(8, Math.min(30, Number(value) || 12)).toString()); }); });
      }, { min: "8", max: "30", step: "1" })));
      editor.textControls.appendChild(makeField("Peso", makeSelect(firstText.getAttribute("font-weight") || "600", [["400", "Normale"], ["600", "Medio"], ["700", "Grassetto"]], function (value) {
        runWithSnapshot(wrap, function () { textNodes(el).forEach(function (text) { text.setAttribute("font-weight", value); }); });
      })));
      editor.textControls.appendChild(makeField("Allinea", makeSelect(firstText.getAttribute("text-anchor") || "middle", [["start", "Sinistra"], ["middle", "Centro"], ["end", "Destra"]], function (value) {
        runWithSnapshot(wrap, function () { textNodes(el).forEach(function (text) { text.setAttribute("text-anchor", value); }); });
      })));
    }

    if (isEdge || el.classList.contains("node")) {
      var edgeTargets = isEdge ? [el] : Array.from(wrap.querySelectorAll('.edge[data-source="' + escapeSelectorId(el.getAttribute("data-id")) + '"],.edge[data-target="' + escapeSelectorId(el.getAttribute("data-id")) + '"]'));
      if (edgeTargets.length) {
        var sample = edgeTargets[0];
        editor.lineControls.appendChild(makeField("Curvatura", makeInput("range", sample.dataset.curvature || "1", function (value) {
          runWithSnapshot(wrap, function () {
            edgeTargets.forEach(function (edge) { edge.dataset.curvature = String(Math.max(0, Math.min(2, Number(value) || 0))); });
            updateEdges(wrap.querySelector("svg"), pageKind());
          });
        }, { min: "0", max: "2", step: "0.05" })));
        editor.lineControls.appendChild(makeField("Tratto", makeSelect(sample.getAttribute("stroke-dasharray") ? "dash" : "solid", [["solid", "Continuo"], ["dash", "Tratteggiato"]], function (value) {
          runWithSnapshot(wrap, function () {
            edgeTargets.forEach(function (edge) { value === "dash" ? edge.setAttribute("stroke-dasharray", "7 5") : edge.removeAttribute("stroke-dasharray"); });
          });
        })));
        editor.lineControls.appendChild(makeField("Punta", makeInput("number", (svg.querySelector("marker[id]") || {}).getAttribute ? (svg.querySelector("marker[id]").getAttribute("markerWidth") || "5.2") : "5.2", function (value) {
          runWithSnapshot(wrap, function () {
            svg.querySelectorAll("marker[id]").forEach(function (marker) {
              var size = Math.max(2, Math.min(12, Number(value) || 5.2));
              marker.setAttribute("markerWidth", String(size));
              marker.setAttribute("markerHeight", String(size));
              marker.setAttribute("refX", "9");
              marker.setAttribute("refY", "5");
              marker.setAttribute("orient", "auto-start-reverse");
              marker.setAttribute("markerUnits", "strokeWidth");
            });
          });
        }, { min: "2", max: "12", step: "0.5" })));
      }
    }
  }

  function createEditorPanel(wrap) {
    var panel = document.createElement("aside");
    panel.className = "graph-editor-panel";
    panel.hidden = true;
    panel.innerHTML = '<details open><summary>Elemento selezionato</summary><p class="graph-editor-selected"></p><p class="graph-editor-id"></p></details><details open><summary>Testo</summary><div class="graph-editor-controls graph-editor-text-controls"></div></details><details open><summary>Aspetto</summary><div class="graph-editor-controls graph-editor-appearance-controls"></div></details><details open><summary>Margine</summary><div class="graph-editor-controls graph-editor-margin-controls"></div></details><details open><summary>Campitura</summary><div class="graph-editor-controls graph-editor-fill-controls"></div></details><details open><summary>Dimensioni e posizione</summary><div class="graph-editor-controls graph-editor-geometry-controls"></div></details><details open><summary>Linee e frecce</summary><div class="graph-editor-controls graph-editor-line-controls"></div></details><details><summary>Allineamento</summary><div class="graph-editor-actions"></div></details><details><summary>Blocco</summary><div class="graph-editor-controls graph-editor-lock-controls"></div></details><details><summary>Griglia e vista</summary><p class="graph-editor-note">Pan con tasto destro, zoom con rotella.</p></details><details><summary>Salvataggio</summary><p class="graph-editor-note">Importa o esporta solo configurazioni grafiche.</p></details>';
    wrap.appendChild(panel);
    return panel;
  }

  function setupGraphEditor(wrap, svg, kind) {
    if (!editorAllowed(kind) || graphEditors.has(wrap)) return;
    storeOriginals(svg);
    var toolbar = document.createElement("div");
    toolbar.className = "graph-editor-toolbar";
    var panel = createEditorPanel(wrap);
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.hidden = true;
    wrap.appendChild(fileInput);
    var imageInput = document.createElement("input");
    imageInput.type = "file";
    imageInput.accept = "image/png,image/jpeg,image/webp";
    imageInput.hidden = true;
    wrap.appendChild(imageInput);

    var editor = { kind: kind, svg: svg, toolbar: toolbar, panel: panel, fileInput: fileInput, imageInput: imageInput, enabled: false, mode: "select", showLocked: false, undo: [], redo: [], silent: false };
    graphEditors.set(wrap, editor);
    editor.selectedLabel = panel.querySelector(".graph-editor-selected");
    editor.selectedId = panel.querySelector(".graph-editor-id");
    editor.textControls = panel.querySelector(".graph-editor-text-controls");
    editor.appearanceControls = panel.querySelector(".graph-editor-appearance-controls");
    editor.marginControls = panel.querySelector(".graph-editor-margin-controls");
    editor.fillControls = panel.querySelector(".graph-editor-fill-controls");
    editor.geometryControls = panel.querySelector(".graph-editor-geometry-controls");
    editor.lineControls = panel.querySelector(".graph-editor-line-controls");
    editor.lockControls = panel.querySelector(".graph-editor-lock-controls");
    var alignActions = panel.querySelector(".graph-editor-actions");
    alignActions.appendChild(makeEditorButton("Porta al centro", function () {
      if (!selectedElement || selectedElement.closest(".graph-wrap") !== wrap) return;
      if (selectedElement.classList.contains("edge")) return;
      runWithSnapshot(wrap, function () {
        var vb = svg.viewBox.baseVal;
        var box = shapeBox(selectedElement);
        var c = center(box);
        var offset = getNodeOffset(selectedElement);
        setNodeOffset(selectedElement, offset.x + vb.x + vb.width / 2 - c.x, offset.y + vb.y + vb.height / 2 - c.y);
        updateEdges(svg, kind, selectedElement.getAttribute("data-id"));
      });
    }));

    function setMode(mode) {
      editor.mode = mode;
      wrap.classList.toggle("is-drawing-annotation", mode === "draw-rectangle");
      updateEditorActions(wrap);
    }

    function cancelActiveEditorOperation() {
      if (annotationDrawState && annotationDrawState.wrap === wrap) {
        if (annotationDrawState.preview) annotationDrawState.preview.remove();
        try { wrap.releasePointerCapture(annotationDrawState.pointerId); } catch (error) {}
        annotationDrawState = null;
      }
      wrap.classList.remove("is-drawing-annotation");
      editor.mode = "select";
      toolbar.querySelectorAll(".graph-editor-menu[open]").forEach(function (menu) { menu.removeAttribute("open"); });
      setSelectedElement(null);
    }

    var toggle = makeEditorButton("Modifica grafico", function () {
      editor.enabled = !editor.enabled;
      wrap.classList.toggle("is-editor-mode", editor.enabled);
      panel.hidden = !editor.enabled;
      toggle.classList.toggle("active", editor.enabled);
      if (editor.enabled) setMode("select");
      else cancelActiveEditorOperation();
      refreshEditorPanel(wrap);
      updateEditorActions(wrap);
    });
    toolbar.appendChild(toggle);
    var selectButton = makeEditorButton("Seleziona", function () { setMode("select"); });
    selectButton.setAttribute("data-graph-mode", "select");
    toolbar.appendChild(selectButton);

    var undoButton = makeEditorButton("Annulla", function () {
      if (!editor.undo.length) return;
      editor.redo.push(snapshotGraph(wrap));
      editor.silent = true;
      applyGraphSnapshot(wrap, editor.undo.pop());
      editor.silent = false;
      saveLocalGraphConfig(wrap);
      updateEditorActions(wrap);
    });
    undoButton.setAttribute("data-editor-requires", "undo");
    toolbar.appendChild(undoButton);

    var redoButton = makeEditorButton("Ripeti", function () {
      if (!editor.redo.length) return;
      editor.undo.push(snapshotGraph(wrap));
      editor.silent = true;
      applyGraphSnapshot(wrap, editor.redo.pop());
      editor.silent = false;
      saveLocalGraphConfig(wrap);
      updateEditorActions(wrap);
    });
    redoButton.setAttribute("data-editor-requires", "redo");
    toolbar.appendChild(redoButton);

    var drawMenu = makeEditorMenu("Disegna");
    var boxButton = makeEditorButton("Disegna riquadro", function () { setMode("draw-rectangle"); drawMenu.details.removeAttribute("open"); });
    boxButton.setAttribute("data-graph-mode", "draw-rectangle");
    drawMenu.content.appendChild(boxButton);
    toolbar.appendChild(drawMenu.details);

    var insertMenu = makeEditorMenu("Inserisci");
    insertMenu.content.appendChild(makeEditorButton("Inserisci immagine da file", function () { imageInput.click(); insertMenu.details.removeAttribute("open"); }));
    insertMenu.content.appendChild(makeEditorButton("Inserisci immagine da URL", function () {
      var choice = window.prompt ? window.prompt("URL o percorso relativo dell'immagine") : "";
      if (choice) runWithSnapshot(wrap, function () { createImageAnnotation(wrap, svg, choice); });
      insertMenu.details.removeAttribute("open");
    }));
    toolbar.appendChild(insertMenu.details);

    var levelsMenu = makeEditorMenu("Livelli");
    var frontButton = makeEditorButton("Porta in primo piano", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () { ensureAnnotationLayers(svg).front.appendChild(selectedElement); });
    });
    frontButton.setAttribute("data-editor-requires", "annotation");
    levelsMenu.content.appendChild(frontButton);
    var forwardButton = makeEditorButton("Porta avanti", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () {
        var next = selectedElement.nextElementSibling;
        if (next) selectedElement.parentNode.insertBefore(next, selectedElement);
      });
    });
    forwardButton.setAttribute("data-editor-requires", "annotation");
    levelsMenu.content.appendChild(forwardButton);
    var backwardButton = makeEditorButton("Porta indietro", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () {
        var previous = selectedElement.previousElementSibling;
        if (previous) selectedElement.parentNode.insertBefore(selectedElement, previous);
      });
    });
    backwardButton.setAttribute("data-editor-requires", "annotation");
    levelsMenu.content.appendChild(backwardButton);
    var backButton = makeEditorButton("Porta sullo sfondo", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () { ensureAnnotationLayers(svg).back.appendChild(selectedElement); });
    });
    backButton.setAttribute("data-editor-requires", "annotation");
    levelsMenu.content.appendChild(backButton);
    var lockButton = makeEditorButton("Blocca", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () { selectedElement.dataset.locked = "1"; });
    });
    lockButton.setAttribute("data-editor-requires", "unlockedAnnotation");
    levelsMenu.content.appendChild(lockButton);
    var unlockButton = makeEditorButton("Sblocca", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () { selectedElement.dataset.locked = "0"; });
    });
    unlockButton.setAttribute("data-editor-requires", "lockedAnnotation");
    levelsMenu.content.appendChild(unlockButton);
    var lockedButton = makeEditorButton("Mostra elementi bloccati", function () {
      editor.showLocked = !editor.showLocked;
      wrap.classList.toggle("show-locked-annotations", editor.showLocked);
      lockedButton.textContent = editor.showLocked ? "Nascondi elementi bloccati" : "Mostra elementi bloccati";
      updateEditorActions(wrap);
    });
    lockedButton.setAttribute("data-editor-toggle", "locked");
    levelsMenu.content.appendChild(lockedButton);
    toolbar.appendChild(levelsMenu.details);

    var editMenu = makeEditorMenu("Modifica");
    var deleteButton = makeEditorButton("Elimina annotazione", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () {
        var doomed = selectedElement;
        setSelectedElement(null);
        doomed.remove();
      });
    });
    deleteButton.setAttribute("data-editor-requires", "annotation");
    editMenu.content.appendChild(deleteButton);
    editMenu.content.appendChild(makeEditorButton("Ripristina elemento", function () {
      if (!selectedElement || selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () { resetElement(wrap, selectedElement); });
    }));
    editMenu.content.lastChild.setAttribute("data-editor-requires", "nonAnnotation");
    var resetAnnotationButton = makeEditorButton("Ripristina annotazione", function () {
      if (!selectedElement || !selectedElement.classList.contains("graph-annotation")) return;
      runWithSnapshot(wrap, function () { resetAnnotation(selectedElement); });
    });
    resetAnnotationButton.setAttribute("data-editor-requires", "annotation");
    editMenu.content.appendChild(resetAnnotationButton);
    editMenu.content.appendChild(makeEditorButton("Ripristina grafico", function () { runWithSnapshot(wrap, function () { resetGraph(wrap); }); }));
    toolbar.appendChild(editMenu.details);

    var viewMenu = makeEditorMenu("Vista");
    var gridButton = makeEditorButton("Mostra griglia", function () {
      wrap.classList.toggle("hide-graph-grid");
      updateEditorActions(wrap);
    });
    gridButton.setAttribute("data-editor-toggle", "grid");
    viewMenu.content.appendChild(gridButton);
    viewMenu.content.appendChild(makeEditorButton("Ripristina vista", function () { runWithSnapshot(wrap, function () { resetView(wrap); }); }));
    toolbar.appendChild(viewMenu.details);

    var configMenu = makeEditorMenu("Configurazione");
    configMenu.content.appendChild(makeEditorButton("Importa configurazione", function () { fileInput.click(); }));
    configMenu.content.appendChild(makeEditorButton("Esporta configurazione", function () {
      var blob = new Blob([JSON.stringify(snapshotGraph(wrap), null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "configurazione-grafico-" + kind + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }));
    configMenu.content.appendChild(makeEditorButton("Cancella configurazione locale", function () {
      try { localStorage.removeItem("graph-editor-" + location.pathname + "-" + kind); } catch (error) {}
    }));
    toolbar.appendChild(configMenu.details);
    wrap.insertBefore(toolbar, wrap.firstChild);

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      function applyImportedText(text) {
        try {
          var state = JSON.parse(text);
          runWithSnapshot(wrap, function () { applyGraphSnapshot(wrap, state); });
        } catch (error) {}
      }
      if (file.text) {
        file.text().then(applyImportedText).catch(function () {});
      } else {
        var reader = new FileReader();
        reader.addEventListener("load", function () { applyImportedText(String(reader.result || "")); });
        reader.readAsText(file);
      }
      fileInput.value = "";
    });
    imageInput.addEventListener("change", function () {
      var file = imageInput.files && imageInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.addEventListener("load", function () {
        runWithSnapshot(wrap, function () { createImageAnnotation(wrap, svg, String(reader.result || "")); });
      });
      reader.readAsDataURL(file);
      imageInput.value = "";
    });
    setMode("select");
    loadLocalGraphConfig(wrap);
    updateEditorActions(wrap);

    svg.querySelectorAll(".edge[data-source][data-target]").forEach(function (edge) {
      edge.setAttribute("tabindex", "0");
      edge.addEventListener("pointerdown", function (event) {
        if (!editor.enabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activeGraph = wrap;
        setSelectedElement(edge);
      });
    });
  }

  function promoteLayerHeadings(svg, kind) {
    if (kind !== "alimentazione" && kind !== "costruzione") return;
    if (svg.dataset.headingsReady === "1") return;
    var headings = Array.from(svg.querySelectorAll(":scope > text")).filter(function (text) {
      var y = Number(text.getAttribute("y"));
      var weight = text.getAttribute("font-weight") || "";
      return y > 0 && y <= 70 && /700|bold/i.test(weight);
    });
    headings.forEach(function (text, index) {
      var group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "graph-heading");
      group.setAttribute("data-id", "heading-" + kind + "-" + index);
      group.setAttribute("tabindex", "0");
      text.parentNode.insertBefore(group, text);
      group.appendChild(text);
    });
    svg.dataset.headingsReady = "1";
  }

  function isFixedCenterNode(svg, node, kind) {
    return node.classList.contains("node") && kind === "conoscenze" && (svg.classList.contains("knowledge-radial") || svg.querySelector(".edge")) && node === svg.querySelector(".node[data-id]");
  }

  function enableNodeDrag(wrap, svg, kind) {
    svg.querySelectorAll(".node[data-id],.graph-heading[data-id]").forEach(function (node) {
      if (isFixedCenterNode(svg, node, kind)) {
        node.classList.add("is-fixed-node");
        return;
      }
      node.classList.add("is-draggable-node");
      node.setAttribute("tabindex", "0");

      node.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activeGraph = wrap;
        wrap.classList.add("is-active");
        setSelectedElement(node);
        if (graphEditors.get(wrap) && graphEditors.get(wrap).enabled) pushEditorHistory(wrap);
        var p = graphLocalPoint(svg, event);
        var offset = getNodeOffset(node);
        nodeDragState = {
          wrap: wrap,
          svg: svg,
          node: node,
          id: node.getAttribute("data-id"),
          pointerId: event.pointerId,
          startX: p.x,
          startY: p.y,
          baseX: offset.x,
          baseY: offset.y,
          kind: kind
        };
        node.classList.add("is-dragging");
        node.setPointerCapture(event.pointerId);
      });

      node.addEventListener("pointermove", function (event) {
        if (!nodeDragState || nodeDragState.node !== node || nodeDragState.pointerId !== event.pointerId) return;
        event.preventDefault();
        var p = graphLocalPoint(svg, event);
        setNodeOffset(node, nodeDragState.baseX + p.x - nodeDragState.startX, nodeDragState.baseY + p.y - nodeDragState.startY);
        updateEdges(svg, kind, nodeDragState.id);
      });

      function endNodeDrag(event) {
        if (!nodeDragState || nodeDragState.node !== node) return;
        if (event && event.pointerId !== undefined && event.pointerId !== nodeDragState.pointerId) return;
        node.classList.remove("is-dragging");
        try { node.releasePointerCapture(nodeDragState.pointerId); } catch (error) {}
        refreshEditorPanel(wrap);
        saveLocalGraphConfig(wrap);
        updateEditorActions(wrap);
        nodeDragState = null;
      }

      node.addEventListener("pointerup", endNodeDrag);
      node.addEventListener("pointercancel", endNodeDrag);
    });
  }

  function enableGraphViewport(wrap, svg, kind) {
    wrap.classList.add("graph-viewport", "graph-viewport-" + kind);
    wrap.tabIndex = 0;
    wrap.setAttribute("aria-label", "Riquadro grafico interattivo: sinistro su nodi e titoli per spostarli, destro sullo sfondo per pan, rotella per zoom");
    promoteLayerHeadings(svg, kind);
    preparePanZoomLayer(svg);
    ensureAnnotationLayers(svg);
    svg.dataset.viewX = svg.dataset.viewX || "0";
    svg.dataset.viewY = svg.dataset.viewY || "0";
    svg.dataset.viewScale = svg.dataset.viewScale || "1";
    applyTransform(svg, wrap);
    enableNodeDrag(wrap, svg, kind);
    setupGraphEditor(wrap, svg, kind);

    wrap.addEventListener("pointerdown", function (event) {
      activeGraph = wrap;
      document.querySelectorAll(".graph-viewport.is-active").forEach(function (el) {
        if (el !== wrap) el.classList.remove("is-active");
      });
      wrap.classList.add("is-active");

      var editor = graphEditors.get(wrap);
      var onChrome = event.target.closest(".graph-editor-toolbar,.graph-editor-panel");
      var onGraphItem = event.target.closest(".node,.graph-heading,.edge,.graph-annotation,.graph-annotation-preview");
      if (editor && editor.enabled && editor.mode === "draw-rectangle" && event.button === 0 && !onChrome && !onGraphItem) {
        event.preventDefault();
        event.stopPropagation();
        var start = graphLocalPoint(svg, event);
        var layers = ensureAnnotationLayers(svg);
        var preview = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        preview.setAttribute("class", "graph-annotation-preview");
        preview.setAttribute("x", start.x.toFixed(1));
        preview.setAttribute("y", start.y.toFixed(1));
        preview.setAttribute("width", "1");
        preview.setAttribute("height", "1");
        preview.setAttribute("fill", "#f6d77a");
        preview.setAttribute("fill-opacity", "0.15");
        preview.setAttribute("stroke", "#8b6f35");
        preview.setAttribute("stroke-width", "1.5");
        preview.setAttribute("stroke-dasharray", "6 4");
        (layers.back || layers.front).appendChild(preview);
        annotationDrawState = { wrap: wrap, svg: svg, pointerId: event.pointerId, start: start, preview: preview };
        wrap.setPointerCapture(event.pointerId);
        return;
      }

      if (!onGraphItem && !onChrome && event.button === 0) setSelectedElement(null);
      if (event.button !== 2 || event.target.closest(".node,.graph-heading,.graph-annotation")) return;
      event.preventDefault();
      var state = currentTransform(svg);
      panState = { wrap: wrap, svg: svg, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: state.x, baseY: state.y };
      wrap.classList.add("is-panning");
      wrap.setPointerCapture(event.pointerId);
    });

    wrap.addEventListener("pointermove", function (event) {
      if (annotationDrawState && annotationDrawState.wrap === wrap && annotationDrawState.pointerId === event.pointerId) {
        event.preventDefault();
        var point = graphLocalPoint(svg, event);
        var x = Math.min(annotationDrawState.start.x, point.x);
        var y = Math.min(annotationDrawState.start.y, point.y);
        var width = Math.abs(point.x - annotationDrawState.start.x);
        var height = Math.abs(point.y - annotationDrawState.start.y);
        annotationDrawState.preview.setAttribute("x", x.toFixed(1));
        annotationDrawState.preview.setAttribute("y", y.toFixed(1));
        annotationDrawState.preview.setAttribute("width", Math.max(1, width).toFixed(1));
        annotationDrawState.preview.setAttribute("height", Math.max(1, height).toFixed(1));
        return;
      }
      if (!panState || panState.wrap !== wrap || panState.pointerId !== event.pointerId) return;
      event.preventDefault();
      var vb = svg.viewBox && svg.viewBox.baseVal;
      var scaleX = vb && wrap.clientWidth ? vb.width / wrap.clientWidth : 1;
      var scaleY = vb && wrap.clientHeight ? vb.height / wrap.clientHeight : scaleX;
      svg.dataset.viewX = String(panState.baseX + (event.clientX - panState.startX) * scaleX);
      svg.dataset.viewY = String(panState.baseY + (event.clientY - panState.startY) * scaleY);
      applyTransform(svg, wrap);
    });

    function endPan(event) {
      if (annotationDrawState && annotationDrawState.wrap === wrap) {
        if (event && event.pointerId !== undefined && event.pointerId !== annotationDrawState.pointerId) return;
        var preview = annotationDrawState.preview;
        var bounds = {
          x: Number(preview.getAttribute("x")),
          y: Number(preview.getAttribute("y")),
          width: Number(preview.getAttribute("width")),
          height: Number(preview.getAttribute("height"))
        };
        preview.remove();
        try { wrap.releasePointerCapture(annotationDrawState.pointerId); } catch (error) {}
        annotationDrawState = null;
        if (bounds.width >= 10 && bounds.height >= 10) {
          pushEditorHistory(wrap);
          createBoxAnnotation(wrap, svg, bounds);
          saveLocalGraphConfig(wrap);
        }
        var editor = graphEditors.get(wrap);
        if (editor) {
          editor.mode = "select";
          wrap.classList.remove("is-drawing-annotation");
          updateEditorActions(wrap);
        }
        return;
      }
      if (!panState || panState.wrap !== wrap) return;
      if (event && event.pointerId !== undefined && event.pointerId !== panState.pointerId) return;
      wrap.classList.remove("is-panning");
      try { wrap.releasePointerCapture(panState.pointerId); } catch (error) {}
      panState = null;
    }

    wrap.addEventListener("pointerup", endPan);
    wrap.addEventListener("pointercancel", endPan);
    wrap.addEventListener("contextmenu", function (event) { event.preventDefault(); });

    wrap.addEventListener("keydown", function (event) {
      var currentEditor = graphEditors.get(wrap);
      if (currentEditor && currentEditor.enabled && event.key === "Escape") setSelectedElement(null);
    });

    wrap.addEventListener("wheel", function (event) {
      if (activeGraph !== wrap && !wrap.classList.contains("is-active")) return;
      event.preventDefault();
      var state = currentTransform(svg);
      var oldScale = state.scale;
      var nextScale = Math.min(zoomMax, Math.max(zoomMin, oldScale * Math.exp(-event.deltaY * 0.0012)));
      if (nextScale === oldScale) return;
      var p = svgPoint(svg, event);
      var worldX = (p.x - state.x) / oldScale;
      var worldY = (p.y - state.y) / oldScale;
      svg.dataset.viewScale = String(nextScale);
      svg.dataset.viewX = String(p.x - worldX * nextScale);
      svg.dataset.viewY = String(p.y - worldY * nextScale);
      applyTransform(svg, wrap);
    }, { passive: false });
  }

  function parseNumber(text) {
    var match = String(text || "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function fitLine(samples, axis) {
    if (samples.length < 2) return null;
    samples.sort(function (a, b) { return a[axis] - b[axis]; });
    var first = samples[0];
    var last = samples[samples.length - 1];
    var delta = last[axis] - first[axis];
    if (!delta) return null;
    var scale = (last.value - first.value) / delta;
    return function (v) { return first.value + (v - first[axis]) * scale; };
  }

  function initLeafletMaps() {
    if (!window.L) return;
    document.querySelectorAll(".leaflet-provenance-map[data-places]").forEach(function (el) {
      if (el.dataset.ready === "1") return;
      var places;
      var flows;
      try {
        places = JSON.parse(el.dataset.places || "[]");
        flows = JSON.parse(el.dataset.flows || "[]");
      } catch (error) {
        return;
      }
      var byId = new Map();
      places.forEach(function (place) { byId.set(place.id, place); });
      var map = L.map(el, { scrollWheelZoom: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);
      var bounds = [];
      places.forEach(function (place) {
        if (place.lat == null || place.lon == null) return;
        var latlng = [Number(place.lat), Number(place.lon)];
        bounds.push(latlng);
        L.circleMarker(latlng, {
          radius: place.kind === "centro" ? 7 : 5,
          weight: 1.5,
          color: "#2f4a40",
          fillColor: place.kind === "centro" ? "#2f4a40" : "#ffffff",
          fillOpacity: .92
        }).bindTooltip(place.label || place.id, { permanent: true, direction: "top", className: "map-label" }).addTo(map);
      });
      flows.forEach(function (flow) {
        var a = byId.get(flow.source);
        var b = byId.get(flow.target);
        if (!a || !b || a.lat == null || b.lat == null || a.lon == null || b.lon == null) return;
        L.polyline([[Number(a.lat), Number(a.lon)], [Number(b.lat), Number(b.lon)]], { color: "#2f4a40", weight: 1.4, opacity: .72 }).addTo(map);
      });
      if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
      el.dataset.ready = "1";
      if (el.nextElementSibling && el.nextElementSibling.classList.contains("provenance-svg-fallback")) {
        el.nextElementSibling.hidden = true;
      }
    });
  }

  function inferLeafletFromSvg() {
    document.querySelectorAll(".graph-wrap").forEach(function (wrap) {
      if (wrap.querySelector(".leaflet-provenance-map")) return;
      var svg = wrap.querySelector("svg");
      if (!svg || !/Territori di approvvigionamento/.test(svg.textContent || "")) return;
      var mapRect = Array.from(svg.querySelectorAll("rect")).sort(function (a, b) {
        return (Number(b.getAttribute("width")) * Number(b.getAttribute("height"))) - (Number(a.getAttribute("width")) * Number(a.getAttribute("height")));
      })[0];
      if (!mapRect) return;
      var rx = Number(mapRect.getAttribute("x"));
      var ry = Number(mapRect.getAttribute("y"));
      var rw = Number(mapRect.getAttribute("width"));
      var rh = Number(mapRect.getAttribute("height"));
      var lonSamples = [];
      var latSamples = [];
      svg.querySelectorAll("text").forEach(function (text) {
        var value = parseNumber(text.textContent);
        if (value == null) return;
        if (/degE|degW|\u00b0E|\u00b0W/.test(text.textContent)) lonSamples.push({ x: Number(text.getAttribute("x")), value: value });
        if (/degN|degS|\u00b0N|\u00b0S/.test(text.textContent)) latSamples.push({ y: Number(text.getAttribute("y")), value: value });
      });
      var lonAt = fitLine(lonSamples, "x");
      var latAt = fitLine(latSamples, "y");
      if (!lonAt || !latAt) return;
      var places = [];
      svg.querySelectorAll(".node[data-id]").forEach(function (node) {
        var circle = node.querySelector("circle");
        if (!circle) return;
        var cx = Number(circle.getAttribute("cx"));
        var cy = Number(circle.getAttribute("cy"));
        if (cx < rx || cx > rx + rw || cy < ry || cy > ry + rh) return;
        var title = node.querySelector("title");
        places.push({
          id: node.getAttribute("data-id"),
          label: title ? title.textContent.split(" — ")[0] : node.getAttribute("data-id"),
          lat: latAt(cy),
          lon: lonAt(cx),
          kind: circle.getAttribute("r") && Number(circle.getAttribute("r")) > 10 ? "centro" : "luogo",
          status: node.getAttribute("data-status")
        });
      });
      if (places.length < 2) return;
      var known = new Set(places.map(function (place) { return place.id; }));
      var flows = [];
      svg.querySelectorAll(".edge[data-source][data-target]").forEach(function (edge) {
        var source = edge.getAttribute("data-source");
        var target = edge.getAttribute("data-target");
        if (known.has(source) && known.has(target)) flows.push({ source: source, target: target, status: edge.getAttribute("data-status") });
      });
      var map = document.createElement("div");
      map.className = "leaflet-provenance-map";
      map.dataset.places = JSON.stringify(places);
      map.dataset.flows = JSON.stringify(flows);
      var fallback = document.createElement("div");
      fallback.className = "provenance-svg-fallback";
      wrap.insertBefore(map, svg);
      fallback.appendChild(svg);
      wrap.appendChild(fallback);
    });
  }

  function loadLeafletIfNeeded() {
    if (!document.querySelector(".leaflet-provenance-map[data-places]")) return;
    if (window.L) {
      initLeafletMaps();
      return;
    }
    if (!document.querySelector('link[data-leaflet="css"]')) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.leaflet = "css";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-leaflet="js"]')) {
      var script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.defer = true;
      script.dataset.leaflet = "js";
      script.addEventListener("load", initLeafletMaps);
      document.head.appendChild(script);
    }
  }

  function resolveTimeline(svg) {
    if (svg.querySelector(".edge")) return;
    var nodes = Array.from(svg.querySelectorAll(".node[data-id]"));
    if (nodes.length < 2) return;
    var rows = new Map();
    nodes.forEach(function (node) {
      var box = shapeBox(node);
      var key = Math.round(center(box).y / 24) * 24;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ node: node, box: box });
    });
    rows.forEach(function (row) {
      row.sort(function (a, b) { return a.box.x - b.box.x; });
      var tracks = [];
      row.forEach(function (entry) {
        var track = 0;
        while (tracks[track] && entry.box.x < tracks[track] + 14) track += 1;
        tracks[track] = entry.box.x + entry.box.width;
        if (track > 0 && !entry.node.dataset.timelineShifted) {
          entry.node.dataset.timelineShifted = "1";
          entry.node.setAttribute("transform", "translate(0 " + ((track % 2 ? 1 : -1) * Math.ceil(track / 2) * 26) + ")");
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var kind = pageKind();

    if (kind === "provenienze") {
      inferLeafletFromSvg();
      loadLeafletIfNeeded();
      return;
    }

    document.querySelectorAll(".graph-wrap svg").forEach(function (svg) {
      tuneSvg(svg);
      if (kind === "insediamento") {
        resolveTimeline(svg);
        svg.closest(".graph-wrap").classList.add("graph-static-timeline");
        return;
      }
      if (supportsGraphViewport(kind)) {
        updateEdges(svg, kind);
        enableGraphViewport(svg.closest(".graph-wrap"), svg, kind);
      }
    });

    document.querySelectorAll(".node[data-id]").forEach(function (node) {
      node.addEventListener("mouseenter", function () {
        var id = node.getAttribute("data-id");
        var svg = node.closest("svg") || document;
        var related = new Set([id]);
        svg.querySelectorAll(".edge").forEach(function (edge) {
          if (edge.getAttribute("data-source") === id || edge.getAttribute("data-target") === id) {
            related.add(edge.getAttribute("data-source"));
            related.add(edge.getAttribute("data-target"));
          }
        });
        svg.querySelectorAll(".node").forEach(function (candidate) {
          if (!related.has(candidate.getAttribute("data-id"))) candidate.classList.add("is-related-dim");
        });
        svg.querySelectorAll(".edge").forEach(function (edge) {
          if (!related.has(edge.getAttribute("data-source")) || !related.has(edge.getAttribute("data-target"))) edge.classList.add("is-related-dim");
        });
      });
      node.addEventListener("mouseleave", function () { clearRelated(node.closest("svg")); });
    });

    document.addEventListener("pointerdown", function (event) {
      if (!event.target.closest || !event.target.closest(".graph-viewport")) {
        activeGraph = null;
        setSelectedElement(null);
        document.querySelectorAll(".graph-viewport.is-active").forEach(function (wrap) { wrap.classList.remove("is-active"); });
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var currentEditor = activeGraph && activeGraph.wrap ? graphEditors.get(activeGraph.wrap) : null;
      if (currentEditor && currentEditor.enabled) setSelectedElement(null);
    });
  });
}());
