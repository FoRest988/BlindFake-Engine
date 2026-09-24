/**
 * AssetBrowser — Visual panel for browsing, previewing, and dragging
 * assets (textures, models, sounds, scenes, prefabs) into the editor.
 */

import type { EditorApp } from '../EditorApp';
import * as THREE from 'three';

export type AssetType = 'texture' | 'model' | 'audio' | 'scene' | 'prefab' | 'script' | 'material' | 'unknown';

export interface AssetEntry {
  name: string;
  type: AssetType;
  path: string;
  size: number;
  thumbnail?: string; // data URL
  lastModified?: number;
  folder?: string; // virtual folder, defaults to '/'
}

const ICON_MAP: Record<AssetType, string> = {
  texture: '🖼️',
  model: '📦',
  audio: '🔊',
  scene: '🎬',
  prefab: '🧩',
  script: '📜',
  material: '🎨',
  unknown: '📄',
};

const EXT_MAP: Record<string, AssetType> = {
  // Textures
  '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture',
  '.webp': 'texture', '.bmp': 'texture', '.svg': 'texture',
  '.gif': 'texture', '.hdr': 'texture', '.exr': 'texture',
  // Models
  '.glb': 'model', '.gltf': 'model', '.fbx': 'model',
  '.obj': 'model', '.dae': 'model',
  // Audio
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio',
  '.flac': 'audio', '.m4a': 'audio',
  // Scenes
  '.scene': 'scene',
  // Scripts
  '.ts': 'script', '.js': 'script', '.lua': 'script',
  // Materials
  '.mat': 'material',
  // Prefabs
  '.prefab': 'prefab',
  // Compressed textures
  '.ktx2': 'texture', '.ktx': 'texture', '.basis': 'texture',
};

export class AssetBrowser {
  private editor: EditorApp;
  private container!: HTMLElement;
  private contentArea!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private assets: AssetEntry[] = [];
  private filteredAssets: AssetEntry[] = [];
  private viewMode: 'grid' | 'list' = 'grid';
  private currentFilter: AssetType | 'all' = 'all';
  private selectedAsset: AssetEntry | null = null;
  private folders: string[] = ['/', '/Meshes', '/Textures', '/Audio', '/Materials', '/Prefabs'];
  private currentFolder = '/';

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'asset-browser';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `<span>📁 ASSET BROWSER</span>`;
    this.container.appendChild(header);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;background:#2a2a2a;border-bottom:1px solid #333;flex-wrap:wrap;';
    toolbar.innerHTML = `
      <button data-filter="all" class="ab-filter active">All</button>
      <button data-filter="texture" class="ab-filter">🖼️ Texture</button>
      <button data-filter="model" class="ab-filter">📦 Model</button>
      <button data-filter="audio" class="ab-filter">🔊 Audio</button>
      <button data-filter="scene" class="ab-filter">🎬 Scene</button>
      <button data-filter="prefab" class="ab-filter">🧩 Prefab</button>
      <button data-filter="script" class="ab-filter">📜 Script</button>
      <span style="flex:1;"></span>
      <input type="text" placeholder="Search..." class="ab-search" />
      <button data-view="grid" class="ab-view-btn active" title="Grid view">▦</button>
      <button data-view="list" class="ab-view-btn" title="List view">☰</button>
      <button data-action="import" class="ab-import-btn" title="Import files">+ Import</button>
    `;
    this.container.appendChild(toolbar);

    // Style toolbar elements
    toolbar.querySelectorAll('.ab-filter').forEach(el => {
      (el as HTMLElement).style.cssText = 'background:#333;border:1px solid #444;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;';
    });
    toolbar.querySelectorAll('.ab-filter.active').forEach(el => {
      (el as HTMLElement).style.background = '#0078d4';
      (el as HTMLElement).style.color = '#fff';
      (el as HTMLElement).style.borderColor = '#005a9e';
    });

    this.searchInput = toolbar.querySelector('.ab-search') as HTMLInputElement;
    this.searchInput.style.cssText = 'width:120px;padding:2px 6px;background:#1e1e1e;border:1px solid #444;color:#fff;font-size:10px;border-radius:3px;';

    const importBtn = toolbar.querySelector('.ab-import-btn') as HTMLElement;
    importBtn.style.cssText = 'background:#0078d4;border:none;color:#fff;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:10px;';

    toolbar.querySelectorAll('.ab-view-btn').forEach(el => {
      (el as HTMLElement).style.cssText = 'background:none;border:1px solid #444;color:#888;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:12px;';
    });

    // Main area (folder tree + content)
    const mainArea = document.createElement('div');
    mainArea.style.cssText = 'flex:1;display:flex;overflow:hidden;';

    // Folder tree sidebar
    const folderTree = document.createElement('div');
    folderTree.className = 'ab-folder-tree';
    folderTree.style.cssText = 'width:140px;min-width:100px;background:#222;border-right:1px solid #333;overflow-y:auto;padding:4px 0;';
    this.rebuildFolderTree(folderTree);
    mainArea.appendChild(folderTree);

    // Content area
    this.contentArea = document.createElement('div');
    this.contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';
    mainArea.appendChild(this.contentArea);

    this.container.appendChild(mainArea);

    // Preview panel (at bottom)
    const preview = document.createElement('div');
    preview.id = 'ab-preview';
    preview.style.cssText = 'height:60px;min-height:60px;background:#222;border-top:1px solid #333;padding:6px 8px;display:flex;align-items:center;gap:8px;font-size:10px;color:#888;';
    preview.innerHTML = '<span>Select an asset to preview</span>';
    this.container.appendChild(preview);

    this.bindEvents(toolbar);
    this.refreshContent();

    // Support drag-and-drop files
    this.setupDragDrop();

    return this.container;
  }

  private bindEvents(toolbar: HTMLElement): void {
    // Filter buttons
    toolbar.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.ab-filter').forEach(el => {
          (el as HTMLElement).style.background = '#333';
          (el as HTMLElement).style.color = '#aaa';
          (el as HTMLElement).style.borderColor = '#444';
          el.classList.remove('active');
        });
        (btn as HTMLElement).style.background = '#0078d4';
        (btn as HTMLElement).style.color = '#fff';
        (btn as HTMLElement).style.borderColor = '#005a9e';
        btn.classList.add('active');
        this.currentFilter = (btn as HTMLElement).dataset.filter as AssetType | 'all';
        this.applyFilters();
      });
    });

    // View mode
    toolbar.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.ab-view-btn').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        this.viewMode = (btn as HTMLElement).dataset.view as 'grid' | 'list';
        this.refreshContent();
      });
    });

    // Search
    this.searchInput.addEventListener('input', () => {
      this.applyFilters();
    });

    // Import button
    toolbar.querySelector('[data-action="import"]')?.addEventListener('click', () => {
      this.importFiles();
    });
  }

  /** Register an asset */
  addAsset(entry: AssetEntry): void {
    // Avoid duplicates
    const existing = this.assets.findIndex(a => a.path === entry.path);
    if (existing >= 0) {
      this.assets[existing] = entry;
    } else {
      this.assets.push(entry);
    }
    this.applyFilters();
  }

  /** Register multiple assets */
  addAssets(entries: AssetEntry[]): void {
    for (const entry of entries) {
      this.addAsset(entry);
    }
  }

  /** Remove an asset */
  removeAsset(path: string): void {
    this.assets = this.assets.filter(a => a.path !== path);
    this.applyFilters();
  }

  /** Detect asset type from file extension */
  static detectType(filename: string): AssetType {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return EXT_MAP[ext] ?? 'unknown';
  }

  private applyFilters(): void {
    const search = this.searchInput?.value.toLowerCase() ?? '';
    this.filteredAssets = this.assets.filter(a => {
      const folder = a.folder ?? '/';
      if (this.currentFolder !== '/') {
        if (folder !== this.currentFolder && !folder.startsWith(this.currentFolder + '/')) return false;
      }
      if (this.currentFilter !== 'all' && a.type !== this.currentFilter) return false;
      if (search && !a.name.toLowerCase().includes(search)) return false;
      return true;
    });
    this.refreshContent();
  }

  private refreshContent(): void {
    if (!this.contentArea) return;
    this.contentArea.innerHTML = '';

    if (this.filteredAssets.length === 0) {
      this.contentArea.innerHTML = `
        <div style="text-align:center;padding:20px;color:#555;">
          <div style="font-size:24px;margin-bottom:8px;">📁</div>
          <div>No assets found</div>
          <div style="font-size:10px;margin-top:4px;">Drag files here or click Import</div>
        </div>
      `;
      return;
    }

    if (this.viewMode === 'grid') {
      this.renderGridView();
    } else {
      this.renderListView();
    }
  }

  private renderGridView(): void {
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;';

    for (const asset of this.filteredAssets) {
      const card = document.createElement('div');
      card.style.cssText = 'background:#2a2a2a;border:1px solid #333;border-radius:4px;padding:6px;text-align:center;cursor:pointer;transition:border-color 0.2s;';
      card.innerHTML = `
        <div style="width:60px;height:60px;margin:0 auto 4px;display:flex;align-items:center;justify-content:center;background:#1e1e1e;border-radius:3px;font-size:24px;overflow:hidden;">
          ${asset.thumbnail ? `<img src="${asset.thumbnail}" style="width:100%;height:100%;object-fit:cover;" />` : ICON_MAP[asset.type]}
        </div>
        <div style="font-size:9px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${asset.name}">${asset.name}</div>
        <div style="font-size:8px;color:#555;">${this.formatSize(asset.size)}</div>
      `;

      card.addEventListener('click', () => this.selectAsset(asset, card));
      card.addEventListener('dblclick', () => this.openAsset(asset));
      card.addEventListener('contextmenu', (e) => this.showAssetContextMenu(e as MouseEvent, asset));

      // Drag to viewport
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/blindfake-asset', JSON.stringify(asset));
      });

      grid.appendChild(card);
    }

    this.contentArea.appendChild(grid);
  }

  private renderListView(): void {
    const list = document.createElement('div');

    for (const asset of this.filteredAssets) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;padding:3px 6px;gap:8px;cursor:pointer;border-bottom:1px solid #2a2a2a;font-size:11px;';
      row.innerHTML = `
        <span style="font-size:14px;">${ICON_MAP[asset.type]}</span>
        <span style="flex:1;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${asset.name}</span>
        <span style="color:#555;font-size:9px;">${asset.type}</span>
        <span style="color:#555;font-size:9px;min-width:55px;text-align:right;">${this.formatSize(asset.size)}</span>
      `;

      row.addEventListener('click', () => this.selectAsset(asset, row));
      row.addEventListener('dblclick', () => this.openAsset(asset));
      row.addEventListener('contextmenu', (e) => this.showAssetContextMenu(e as MouseEvent, asset));

      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/blindfake-asset', JSON.stringify(asset));
      });

      list.appendChild(row);
    }

    this.contentArea.appendChild(list);
  }

  private selectAsset(asset: AssetEntry, element: HTMLElement): void {
    // Deselect previous
    this.contentArea.querySelectorAll('[data-selected]').forEach(el => {
      (el as HTMLElement).style.borderColor = '#333';
      el.removeAttribute('data-selected');
    });

    element.style.borderColor = '#0078d4';
    element.setAttribute('data-selected', 'true');
    this.selectedAsset = asset;
    this.updatePreview(asset);
  }

  private updatePreview(asset: AssetEntry): void {
    const preview = this.container.querySelector('#ab-preview');
    if (!preview) return;

    preview.innerHTML = `
      <div style="font-size:20px;">${ICON_MAP[asset.type]}</div>
      <div>
        <div style="color:#ccc;font-size:11px;font-weight:600;">${asset.name}</div>
        <div style="color:#666;font-size:9px;">Type: ${asset.type} | Size: ${this.formatSize(asset.size)}</div>
        <div style="color:#555;font-size:9px;">${asset.path}</div>
      </div>
    `;
  }

  private openAsset(asset: AssetEntry): void {
    // Double-click action depends on type
    switch (asset.type) {
      case 'model':
        // Import model into scene
        this.editor.engine.assets.loadModel(asset.path).then(model => {
          model.scene.name = asset.name.replace(/\.[^.]+$/, '');
          model.scene.traverse((child: any) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const mat of mats) {
                mat.needsUpdate = true;
                if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.needsUpdate = true; }
                if (mat.emissiveMap) { mat.emissiveMap.colorSpace = THREE.SRGBColorSpace; mat.emissiveMap.needsUpdate = true; }
              }
            }
          });
          this.editor.scene.add(model.scene);
          this.editor.select(model.scene);
          this.editor.hierarchy.refresh();
        }).catch(err => console.error('Failed to load model:', err));
        break;
      case 'texture':
        // Could open in material editor
        console.info(`[AssetBrowser] Open texture: ${asset.name}`);
        break;
      case 'audio': {
        // Preview audio
        const audio = new Audio(asset.path);
        audio.play().catch(() => {});
        setTimeout(() => audio.pause(), 5000);
        break;
      }
      default:
        console.info(`[AssetBrowser] Open: ${asset.name} (${asset.type})`);
    }
  }

  private importFiles(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = Object.keys(EXT_MAP).join(',');
    input.onchange = () => {
      if (input.files) {
        for (const file of Array.from(input.files)) {
          const url = URL.createObjectURL(file);
          const assetType = AssetBrowser.detectType(file.name);
          this.addAsset({
            name: file.name,
            type: assetType,
            path: url,
            size: file.size,
            lastModified: file.lastModified,
            folder: this.currentFolder,
          });

          // Generate thumbnail — images are fast, 3D models are async
          if (assetType === 'texture') {
            this.generateThumbnail(url, file.name);
          } else if (assetType === 'model') {
            this.generateModelThumbnail(url, file.name);
          }
        }
      }
    };
    input.click();
  }

  private generateThumbnail(url: string, name: string): void {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 80;
      const ctx = canvas.getContext('2d')!;
      const aspect = img.width / img.height;
      let dw = 80, dh = 80;
      if (aspect > 1) dh = 80 / aspect;
      else dw = 80 * aspect;
      ctx.drawImage(img, (80 - dw) / 2, (80 - dh) / 2, dw, dh);

      const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      const asset = this.assets.find(a => a.name === name);
      if (asset) {
        asset.thumbnail = thumbnail;
        this.refreshContent();
      }
    };
    img.src = url;
  }

  /**
   * Render a static preview thumbnail for a 3D model using an offscreen
   * Three.js WebGLRenderer (80×80 px). The renderer is disposed after one frame.
   */
  private async generateModelThumbnail(url: string, name: string): Promise<void> {
    try {
      const model = await this.editor.engine.assets.loadModel(url);

      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 80;

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
      renderer.setSize(80, 80);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a2a2a);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dir = new THREE.DirectionalLight(0xffffff, 1.2);
      dir.position.set(1, 2, 1.5);
      scene.add(dir);

      const obj = model.scene.clone(true);
      scene.add(obj);

      // Auto-frame: compute bounding box, move camera to fit
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;

      const camera = new THREE.PerspectiveCamera(45, 1, maxDim * 0.001, maxDim * 20);
      camera.position.set(
        center.x + maxDim * 0.9,
        center.y + maxDim * 0.55,
        center.z + maxDim * 0.9,
      );
      camera.lookAt(center);

      renderer.render(scene, camera);

      const thumbnail = canvas.toDataURL('image/jpeg', 0.75);

      // Dispose offscreen resources immediately
      renderer.dispose();
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry?.dispose();
        }
      });

      const asset = this.assets.find(a => a.name === name);
      if (asset) {
        asset.thumbnail = thumbnail;
        this.refreshContent();
      }
    } catch {
      // Silently skip — thumbnails are cosmetic
    }
  }

  private setupDragDrop(): void {
    this.contentArea?.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      this.contentArea.style.background = '#1a2a3a';
    });

    this.contentArea?.addEventListener('dragleave', () => {
      this.contentArea.style.background = '';
    });

    this.contentArea?.addEventListener('drop', (e) => {
      e.preventDefault();
      this.contentArea.style.background = '';

      if (e.dataTransfer?.files) {
        for (const file of Array.from(e.dataTransfer.files)) {
          const url = URL.createObjectURL(file);
          this.addAsset({
            name: file.name,
            type: AssetBrowser.detectType(file.name),
            path: url,
            size: file.size,
            lastModified: file.lastModified,
            folder: this.currentFolder,
          });
        }
      }
    });
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  refresh(): void {
    this.scanSceneAssets();
    this.applyFilters();
  }

  /** Auto-scan scene objects to populate asset entries for in-use textures and models */
  private scanSceneAssets(): void {
    const seen = new Set(this.assets.map(a => a.path));
    this.editor.scene.traverse((obj: THREE.Object3D) => {
      // Meshes with materials → extract textures
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const pbr = mat as THREE.MeshStandardMaterial;
          if (pbr.map && pbr.map.image && !seen.has('scene://tex/' + pbr.map.id)) {
            const id = 'scene://tex/' + pbr.map.id;
            seen.add(id);
            this.assets.push({
              name: pbr.map.name || mat.name || obj.name + '_diffuse',
              type: 'texture',
              path: id,
              size: 0,
              folder: '/Textures',
            });
          }
        }
      }
      // Loaded models (userData.assetPath)
      if (obj.userData?.assetPath && !seen.has(obj.userData.assetPath)) {
        const p = obj.userData.assetPath as string;
        seen.add(p);
        this.assets.push({
          name: obj.name || p.split('/').pop() || 'model',
          type: 'model',
          path: p,
          size: 0,
          folder: '/Meshes',
        });
      }
    });
  }

  private rebuildFolderTree(container: HTMLElement): void {
    container.innerHTML = '';
    for (const folder of this.folders) {
      const item = document.createElement('div');
      const isActive = folder === this.currentFolder;
      item.style.cssText = `padding:3px 8px 3px ${8 + (folder.split('/').length - 1) * 12}px;font-size:10px;cursor:pointer;color:${isActive ? '#fff' : '#aaa'};background:${isActive ? '#0078d4' : 'transparent'};display:flex;align-items:center;gap:4px;`;
      item.innerHTML = `<span>📁</span><span>${folder === '/' ? 'Content' : folder.split('/').pop()}</span>`;
      item.addEventListener('click', () => {
        this.currentFolder = folder;
        this.rebuildFolderTree(container);
        this.applyFilters();
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showFolderContextMenu(e as MouseEvent, folder, container);
      });
      container.appendChild(item);
    }
  }

  private showFolderContextMenu(e: MouseEvent, folder: string, treeContainer: HTMLElement): void {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="new-folder">📁 New Folder</div>
      ${folder !== '/' ? '<div class="context-menu-item" data-action="rename-folder">Rename</div>' : ''}
      ${folder !== '/' ? '<div class="context-menu-item" data-action="delete-folder" style="color:#e74c3c;">Delete Folder</div>' : ''}
    `;
    document.body.appendChild(menu);

    menu.addEventListener('click', (ev) => {
      const action = (ev.target as HTMLElement).closest('.context-menu-item')?.getAttribute('data-action');
      if (action === 'new-folder') {
        const name = prompt('New folder name:');
        if (name) {
          const path = folder === '/' ? `/${name}` : `${folder}/${name}`;
          if (!this.folders.includes(path)) {
            this.folders.push(path);
            this.rebuildFolderTree(treeContainer);
          }
        }
      } else if (action === 'delete-folder') {
        this.folders = this.folders.filter(f => f !== folder && !f.startsWith(folder + '/'));
        if (this.currentFolder === folder) this.currentFolder = '/';
        this.rebuildFolderTree(treeContainer);
      }
      menu.remove();
    });

    const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  private showAssetContextMenu(e: MouseEvent, asset: AssetEntry): void {
    e.preventDefault();
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="open">Open</div>
      <div class="context-menu-item" data-action="rename">Rename</div>
      <div class="context-menu-item" data-action="move">📁 Move to Folder…</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="copy-path">Copy Path</div>
      <div class="context-menu-item" data-action="duplicate">Duplicate</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="delete" style="color:#e74c3c;">Delete</div>
    `;
    document.body.appendChild(menu);

    menu.addEventListener('click', (ev) => {
      const action = (ev.target as HTMLElement).closest('.context-menu-item')?.getAttribute('data-action');
      switch (action) {
        case 'open': this.openAsset(asset); break;
        case 'rename': {
          const newName = prompt('Rename asset:', asset.name);
          if (newName) { asset.name = newName; this.refreshContent(); }
          break;
        }
        case 'copy-path': navigator.clipboard.writeText(asset.path); break;
        case 'duplicate': {
          this.addAsset({ ...asset, name: asset.name.replace(/(\.[^.]+)$/, '_copy$1'), path: asset.path });
          break;
        }
        case 'move': {
          const target = prompt('Move to folder:', asset.folder ?? '/');
          if (target && this.folders.includes(target)) {
            asset.folder = target;
            this.applyFilters();
          } else if (target) {
            alert('Folder not found. Create it first.');
          }
          break;
        }
        case 'delete': {
          this.assets = this.assets.filter(a => a !== asset);
          this.applyFilters();
          break;
        }
      }
      menu.remove();
    });

    const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  dispose(): void {
    this.assets.length = 0;
    this.filteredAssets.length = 0;
  }
}
