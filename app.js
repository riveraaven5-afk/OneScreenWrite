pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');

let pages = [[]];
let pageHistory = [[]]; // Stack for Redo tracking
let currentPageIndex = 0;

let currentTool = 'select';
let strokeColor = '#000000';
let strokeWidth = 5;

let canvasBgColor = '#dcdfdc';
let canvasTemplate = 'none';
let bgImageObj = null;

let selectedElement = null;
let isDrawing = false;
let isDragging = false;
let isResizing = false;

let dragStart = { x: 0, y: 0 };
let currentDrawing = null;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.scale(dpr, dpr);
  redrawCanvas();
}

window.addEventListener('resize', resizeCanvas);

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function getBounds(item) {
  if (item.type === 'stroke') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    item.points.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    const padding = item.width / 2 + 6;
    return { x: minX - padding, y: minY - padding, w: (maxX - minX) + padding * 2, h: (maxY - minY) + padding * 2 };
  } else if (item.type === 'image') {
    return { x: item.x, y: item.y, w: item.w, h: item.h };
  }
}

function getHandles(bounds) {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h }
  ];
}

function drawBackground() {
  ctx.fillStyle = canvasBgColor;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  if (bgImageObj) {
    ctx.drawImage(bgImageObj, 0, 0, window.innerWidth, window.innerHeight);
  }

  ctx.strokeStyle = '#cbd5e1';
  ctx.fillStyle = '#94a3b8';

  if (canvasTemplate === 'ruled') {
    ctx.lineWidth = 1.5;
    for (let y = 60; y < window.innerHeight; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(window.innerWidth, y);
      ctx.stroke();
    }
  } else if (canvasTemplate === 'stave') {
    ctx.lineWidth = 1;
    for (let y = 80; y < window.innerHeight; y += 120) {
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(40, y + (i * 12));
        ctx.lineTo(window.innerWidth - 40, y + (i * 12));
        ctx.stroke();
      }
    }
  } else if (canvasTemplate === 'grid') {
    ctx.lineWidth = 1;
    for (let x = 0; x < window.innerWidth; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, window.innerHeight);
      ctx.stroke();
    }
    for (let y = 0; y < window.innerHeight; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(window.innerWidth, y);
      ctx.stroke();
    }
  } else if (canvasTemplate === 'dots') {
    for (let x = 20; x < window.innerWidth; x += 25) {
      for (let y = 20; y < window.innerHeight; y += 25) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Smooth Quadratic Curve Drawing Helper
function drawSmoothStroke(stroke) {
  if (!stroke.points || stroke.points.length === 0) return;

  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const pts = stroke.points;

  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (pts.length === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
    return;
  }

  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

function redrawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();

  const currentElements = pages[currentPageIndex] || [];

  currentElements.forEach(item => {
    if (item.type === 'stroke') {
      drawSmoothStroke(item);
    } else if (item.type === 'image') {
      ctx.save();
      if (item.flipped) {
        ctx.translate(item.x + item.w, item.y);
        ctx.scale(-1, 1);
        ctx.drawImage(item.img, 0, 0, item.w, item.h);
      } else {
        ctx.drawImage(item.img, item.x, item.y, item.w, item.h);
      }
      ctx.restore();
    }
  });

  if (currentDrawing) {
    drawSmoothStroke(currentDrawing);
  }

  if (selectedElement && currentTool === 'select') {
    const b = getBounds(selectedElement);

    ctx.save();
    ctx.strokeStyle = '#3b4cca';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();

    const handles = getHandles(b);
    handles.forEach(h => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#3b4cca';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    positionObjectToolbar(b);
  } else {
    document.getElementById('objectToolbar').classList.remove('open');
  }
}

function positionObjectToolbar(bounds) {
  const toolbar = document.getElementById('objectToolbar');
  toolbar.classList.add('open');
  toolbar.style.left = `${bounds.x + bounds.w / 2}px`;
  toolbar.style.top = `${bounds.y + bounds.h + 15}px`;
}

// Event Listeners
canvas.addEventListener('pointerdown', (e) => {
  const pos = getPos(e);
  const currentElements = pages[currentPageIndex];

  if (currentTool === 'select') {
    if (selectedElement) {
      const b = getBounds(selectedElement);
      const handles = getHandles(b);

      for (let i = 0; i < handles.length; i++) {
        if (Math.hypot(pos.x - handles[i].x, pos.y - handles[i].y) <= 12) {
          isResizing = true;
          dragStart = pos;
          return;
        }
      }

      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
        isDragging = true;
        dragStart = pos;
        return;
      }
    }

    selectedElement = null;
    for (let i = currentElements.length - 1; i >= 0; i--) {
      const b = getBounds(currentElements[i]);
      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
        selectedElement = currentElements[i];
        isDragging = true;
        dragStart = pos;
        break;
      }
    }
    redrawCanvas();
    return;
  }

  if (currentTool === 'pen') {
    isDrawing = true;
    selectedElement = null;
    currentDrawing = { type: 'stroke', color: strokeColor, width: strokeWidth, points: [pos] };
    redrawCanvas();
  }

  if (currentTool === 'eraser') {
    pages[currentPageIndex] = currentElements.filter(item => {
      const b = getBounds(item);
      return !(pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h);
    });
    redrawCanvas();
  }
});

canvas.addEventListener('pointermove', (e) => {
  const pos = getPos(e);

  if (isDrawing && currentTool === 'pen') {
    currentDrawing.points.push(pos);
    redrawCanvas();
    return;
  }

  if (isDragging && selectedElement) {
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;
    if (selectedElement.type === 'stroke') {
      selectedElement.points.forEach(p => { p.x += dx; p.y += dy; });
    } else if (selectedElement.type === 'image') {
      selectedElement.x += dx;
      selectedElement.y += dy;
    }
    dragStart = pos;
    redrawCanvas();
    return;
  }

  if (isResizing && selectedElement) {
    const b = getBounds(selectedElement);
    const centerX = b.x + b.w / 2;
    const centerY = b.y + b.h / 2;

    const prevDist = Math.hypot(dragStart.x - centerX, dragStart.y - centerY);
    const newDist = Math.hypot(pos.x - centerX, pos.y - centerY);

    if (prevDist > 0) {
      const scale = newDist / prevDist;
      if (selectedElement.type === 'stroke') {
        selectedElement.points.forEach(p => {
          p.x = centerX + (p.x - centerX) * scale;
          p.y = centerY + (p.y - centerY) * scale;
        });
        selectedElement.width = Math.max(1, selectedElement.width * scale);
      } else if (selectedElement.type === 'image') {
        const nw = selectedElement.w * scale;
        const nh = selectedElement.h * scale;
        selectedElement.x -= (nw - selectedElement.w) / 2;
        selectedElement.y -= (nh - selectedElement.h) / 2;
        selectedElement.w = nw;
        selectedElement.h = nh;
      }
    }
    dragStart = pos;
    redrawCanvas();
  }
});

canvas.addEventListener('pointerup', () => {
  if (isDrawing && currentDrawing) {
    pages[currentPageIndex].push(currentDrawing);
    pageHistory[currentPageIndex] = []; // Clear redo stack on new stroke
    currentDrawing = null;
    autoSaveWhiteboard();
  }
  isDrawing = false;
  isDragging = false;
  isResizing = false;
  redrawCanvas();
});

// Undo & Redo System
document.getElementById('undoBtn').addEventListener('click', () => {
  if (pages[currentPageIndex].length > 0) {
    if (!pageHistory[currentPageIndex]) pageHistory[currentPageIndex] = [];
    const removed = pages[currentPageIndex].pop();
    pageHistory[currentPageIndex].push(removed);
    selectedElement = null;
    redrawCanvas();
    autoSaveWhiteboard();
  }
});

document.getElementById('redoBtn').addEventListener('click', () => {
  if (pageHistory[currentPageIndex] && pageHistory[currentPageIndex].length > 0) {
    const restored = pageHistory[currentPageIndex].pop();
    pages[currentPageIndex].push(restored);
    redrawCanvas();
    autoSaveWhiteboard();
  }
});

// Local Storage Save & Open System
function autoSaveWhiteboard() {
  const serializablePages = pages.map(page => {
    return page.map(item => {
      if (item.type === 'image') {
        return {
          type: 'image',
          src: item.img.src,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          flipped: item.flipped
        };
      }
      return item;
    });
  });

  const whiteboardData = {
    pages: serializablePages,
    currentPageIndex: currentPageIndex,
    canvasBgColor: canvasBgColor,
    canvasTemplate: canvasTemplate
  };

  localStorage.setItem('saved_whiteboard', JSON.stringify(whiteboardData));
}

function loadSavedWhiteboard() {
  const saved = localStorage.getItem('saved_whiteboard');
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    canvasBgColor = data.canvasBgColor || '#dcdfdc';
    canvasTemplate = data.canvasTemplate || 'none';
    currentPageIndex = data.currentPageIndex || 0;

    pages = data.pages.map(page => {
      return page.map(item => {
        if (item.type === 'image') {
          const img = new Image();
          img.src = item.src;
          return { ...item, img: img };
        }
        return item;
      });
    });

    updatePageCounter();
    redrawCanvas();
  } catch (err) {
    console.error('Failed to parse saved whiteboard data', err);
  }
}

// Menu Save & Open Buttons
document.getElementById('menuSave').addEventListener('click', () => {
  autoSaveWhiteboard();
  alert('Whiteboard saved successfully!');
  closeAllPopups();
});

document.getElementById('menuSaveAs').addEventListener('click', () => {
  autoSaveWhiteboard();
  alert('Whiteboard saved!');
  closeAllPopups();
});

document.getElementById('menuOpen').addEventListener('click', () => {
  loadSavedWhiteboard();
  closeAllPopups();
});

// Pen Customization
document.getElementById('penSizeSlider').addEventListener('input', (e) => {
  strokeWidth = parseInt(e.target.value, 10);
});

document.querySelectorAll('.color-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    const color = swatch.getAttribute('data-color');
    if (color) strokeColor = color;
  });
});

// Page Navigation
function updatePageCounter() {
  document.getElementById('pageCounter').textContent = `${currentPageIndex + 1}/${pages.length}`;
}

document.querySelector('[data-tool="add"]').addEventListener('click', () => {
  pages.push([]);
  pageHistory.push([]);
  currentPageIndex = pages.length - 1;
  selectedElement = null;
  updatePageCounter();
  redrawCanvas();
  autoSaveWhiteboard();
});

document.getElementById('prevPageBtn').addEventListener('click', () => {
  if (currentPageIndex > 0) {
    currentPageIndex--;
    selectedElement = null;
    updatePageCounter();
    redrawCanvas();
  }
});

document.getElementById('nextPageBtn').addEventListener('click', () => {
  if (currentPageIndex < pages.length - 1) {
    currentPageIndex++;
    selectedElement = null;
    updatePageCounter();
    redrawCanvas();
  }
});

// Popups & Toolbar Actions
const menuPopup = document.getElementById('menuPopup');
const menuBtn = document.getElementById('menuBtn');
const penPopup = document.getElementById('penPopup');
const penBtn = document.getElementById('penBtn');

function closeAllPopups() {
  menuPopup.classList.remove('open');
  penPopup.classList.remove('open');
  menuBtn.classList.remove('menu-active');
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = menuPopup.classList.contains('open');
  closeAllPopups();
  if (!isOpen) {
    const rect = menuBtn.getBoundingClientRect();
    menuPopup.style.left = `${rect.left}px`;
    menuPopup.classList.add('open');
    menuBtn.classList.add('menu-active');
  }
});

penBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = penPopup.classList.contains('open');
  closeAllPopups();
  if (!isOpen) {
    const rect = penBtn.getBoundingClientRect();
    penPopup.style.left = `${rect.left}px`;
    penPopup.classList.add('open');
  }
  updateActiveToolUI('penBtn');
  currentTool = 'pen';
});

function updateActiveToolUI(btnId) {
  document.querySelectorAll('.tool-item').forEach(btn => btn.classList.remove('active'));
  document.getElementById(btnId).classList.add('active');
}

document.querySelectorAll('.tool-item').forEach(item => {
  if (item.id === 'menuBtn' || item.id === 'penBtn') return;

  item.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();

    if (item.classList.contains('action-btn')) {
      if (item.id === 'clearBtn') {
        pages[currentPageIndex] = [];
        selectedElement = null;
        redrawCanvas();
        autoSaveWhiteboard();
      }
      return;
    }

    updateActiveToolUI(item.id);
    const selected = item.getAttribute('data-tool');
    if (selected) {
      currentTool = selected;
      if (currentTool !== 'select') {
        selectedElement = null;
        redrawCanvas();
      }
    }
  });
});

canvas.addEventListener('pointerdown', closeAllPopups);

// Initialize & Load Saved Session on Launch
resizeCanvas();
loadSavedWhiteboard();