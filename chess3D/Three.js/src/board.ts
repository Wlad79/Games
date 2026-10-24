import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Chess, Square } from "chess.js";

export interface MoveRecord {
  from: Square;
  to: Square;
  san: string;
  promotion?: string;
}

interface PieceMesh extends THREE.Group {
  userData: THREE.Group["userData"] & { square: Square; color: "w" | "b"; type: string };
}

export class ThreeChessBoard {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly tiles = new Map<Square, THREE.Mesh>();
  private readonly pieces = new Map<Square, PieceMesh>();
  private readonly animations: Array<{ mesh: PieceMesh; from: THREE.Vector3; to: THREE.Vector3; started: number }> = [];
  private readonly pointerStart = new THREE.Vector2();
  private readonly onMove: (square: Square) => void;
  private readonly resizeObserver: ResizeObserver;
  private perspective: "w" | "b" = "w";

  constructor(container: HTMLElement, onMove: (square: Square) => void) {
    this.onMove = onMove;
    this.scene.background = new THREE.Color("#101714");
    this.camera.position.set(0, 10, 12);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 19;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minPolarAngle = Math.PI * 0.17;
    this.controls.update();
    this.addLighting();
    this.addBoard();
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  render(chess: Chess, lastMove: MoveRecord | undefined, selected: Square | null, targets: Square[]): void {
    const board = chess.board();
    const nextPieces = new Map<Square, PieceMesh>();
    for (let rank = 0; rank < board.length; rank += 1) {
      for (let file = 0; file < board[rank].length; file += 1) {
        const piece = board[rank][file];
        if (!piece) continue;
        const square = `${"abcdefgh"[file]}${8 - rank}` as Square;
        let mesh = this.pieces.get(square);
        if (mesh && mesh.userData.type === piece.type && mesh.userData.color === piece.color) {
          this.pieces.delete(square);
        } else {
          mesh = undefined;
          if (lastMove?.to === square) {
            const moving = this.pieces.get(lastMove.from);
            if (moving && moving.userData.type === piece.type && moving.userData.color === piece.color) {
              this.pieces.delete(lastMove.from);
              const fromPosition = this.positionFor(lastMove.from);
              const toPosition = this.positionFor(square);
              moving.position.copy(fromPosition);
              this.animations.push({ mesh: moving, from: fromPosition, to: toPosition, started: performance.now() });
              mesh = moving;
            }
          }
          mesh ??= this.createPiece(piece.type, piece.color, square);
          mesh.userData.square = square;
          if (!mesh.parent) this.scene.add(mesh);
        }
        mesh.userData.square = square;
        if (!this.animations.some((animation) => animation.mesh === mesh)) {
          mesh.position.copy(this.positionFor(square));
        }
        nextPieces.set(square, mesh);
      }
    }
    for (const mesh of this.pieces.values()) this.scene.remove(mesh);
    this.pieces.clear();
    for (const [square, mesh] of nextPieces) this.pieces.set(square, mesh);

    for (const [square, tile] of this.tiles) {
      const material = tile.material as THREE.MeshStandardMaterial;
      const rank = Number(square[1]) - 1;
      const file = square.charCodeAt(0) - 97;
      const baseColor = (rank + file) % 2 === 0 ? 0xd3c6a8 : 0x495b50;
      material.color.setHex(square === selected ? 0x9a7550 : targets.includes(square) ? 0x82977a : baseColor);
      material.emissive.setHex(square === selected ? 0x38200f : targets.includes(square) ? 0x18261a : 0x000000);
      material.emissiveIntensity = square === selected || targets.includes(square) ? 0.55 : 0;
    }
  }

  setPerspective(color: "w" | "b"): void {
    if (this.perspective === color) return;
    this.perspective = color;
    this.camera.position.set(0, 10, color === "w" ? 12 : -12);
    this.controls.update();
  }

  clearSelection(): void {
    for (const tile of this.tiles.values()) {
      const material = tile.material as THREE.MeshStandardMaterial;
      material.emissive.setHex(0);
      material.emissiveIntensity = 0;
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerStart.set(event.clientX, event.clientY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects([...this.tiles.values(), ...this.pieces.values()], true);
    const square = intersections
      .map(({ object }) => {
        let candidate: THREE.Object3D | null = object;
        while (candidate && !candidate.userData.square) candidate = candidate.parent;
        return candidate?.userData.square as Square | undefined;
      })
      .find((candidate): candidate is Square => candidate !== undefined);
    if (square) this.onMove(square);
  };

  private addLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xf3ead6, 0x28322d, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffe6bf, 3.2);
    keyLight.position.set(-5, 10, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9baec0, 1.15);
    fillLight.position.set(7, 7, -6);
    this.scene.add(fillLight);
  }

  private addBoard(): void {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(9.5, 0.36, 9.5),
      new THREE.MeshStandardMaterial({ color: 0x45382e, roughness: 0.42, metalness: 0.12 }),
    );
    base.position.y = -0.2;
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(9.18, 0.08, 9.18),
      new THREE.MeshStandardMaterial({ color: 0xa27a50, roughness: 0.52 }),
    );
    inner.position.y = 0.015;
    this.scene.add(inner);
    const tileSize = 1.125;
    for (let rank = 0; rank < 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const square = `${"abcdefgh"[file]}${rank + 1}` as Square;
        const material = new THREE.MeshStandardMaterial({
          color: (rank + file) % 2 === 0 ? 0xd3c6a8 : 0x495b50,
          roughness: 0.82,
          metalness: 0,
          emissive: 0x000000,
        });
        const tile = new THREE.Mesh(new THREE.BoxGeometry(tileSize, 0.045, tileSize), material);
        tile.position.set(...this.positionFor(square).toArray());
        tile.position.y = 0.085;
        tile.receiveShadow = true;
        tile.userData.square = square;
        this.tiles.set(square, tile);
        this.scene.add(tile);
      }
    }
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x101714, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.39;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private createPiece(type: string, color: "w" | "b", square: Square): PieceMesh {
    const group = new THREE.Group() as PieceMesh;
    group.userData = { square, color, type };
    const material = new THREE.MeshStandardMaterial({
      color: color === "w" ? 0xe9dfc9 : 0x18211e,
      roughness: color === "w" ? 0.27 : 0.31,
      metalness: color === "w" ? 0.16 : 0.38,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: color === "w" ? 0xa78a5c : 0x718077,
      roughness: 0.34,
      metalness: 0.6,
    });
    const profiles: Record<string, Array<[number, number]>> = {
      p: [[0, 0], [0.28, 0], [0.32, 0.08], [0.25, 0.15], [0.18, 0.32], [0.13, 0.43], [0.2, 0.5], [0.21, 0.54], [0.16, 0.59], [0.11, 0.56], [0.08, 0.49]],
      r: [[0, 0], [0.32, 0], [0.34, 0.1], [0.25, 0.19], [0.23, 0.52], [0.3, 0.55], [0.3, 0.67], [0.23, 0.67], [0.23, 0.61], [0.17, 0.61], [0.17, 0.67], [0.1, 0.67], [0.1, 0.61], [0.04, 0.61]],
      n: [[0, 0], [0.31, 0], [0.33, 0.1], [0.25, 0.18], [0.21, 0.42], [0.27, 0.49], [0.19, 0.55], [0.22, 0.62], [0.14, 0.68], [0.07, 0.61]],
      b: [[0, 0], [0.31, 0], [0.33, 0.1], [0.24, 0.18], [0.14, 0.38], [0.1, 0.57], [0.18, 0.65], [0.16, 0.7], [0.1, 0.73]],
      q: [[0, 0], [0.34, 0], [0.36, 0.1], [0.25, 0.19], [0.17, 0.48], [0.11, 0.72], [0.2, 0.78], [0.19, 0.83], [0.1, 0.84]],
      k: [[0, 0], [0.34, 0], [0.36, 0.1], [0.25, 0.19], [0.17, 0.52], [0.12, 0.78], [0.21, 0.83], [0.2, 0.88], [0.11, 0.89]],
    };
    const points = profiles[type].map(([radius, height]) => new THREE.Vector2(radius, height));
    const body = new THREE.Mesh(new THREE.LatheGeometry(points, 24), material);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const addSphere = (radius: number, y: number, scale = 1): THREE.Mesh => {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 12), accent);
      sphere.position.y = y;
      sphere.scale.y = scale;
      sphere.castShadow = true;
      group.add(sphere);
      return sphere;
    };
    if (type === "b") {
      addSphere(0.13, 0.64, 1.15);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.19, 0.035), accent);
      slit.position.set(0.03, 0.63, 0);
      slit.rotation.z = 0.35;
      group.add(slit);
    } else if (type === "q") {
      addSphere(0.12, 0.81);
      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2;
        addSphere(0.055, 0.83, 1).position.set(Math.cos(angle) * 0.19, 0.82, Math.sin(angle) * 0.19);
      }
    } else if (type === "k") {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.32, 0.09), accent);
      upright.position.y = 1.04;
      const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.08, 0.09), accent);
      crossbar.position.y = 1.08;
      group.add(upright, crossbar);
    } else if (type === "r") {
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), accent);
        merlon.position.set(Math.cos(angle) * 0.2, 0.69, Math.sin(angle) * 0.2);
        merlon.castShadow = true;
        group.add(merlon);
      }
    } else if (type === "n") {
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.25, 4, 8), material);
      head.position.set(0.03, 0.69, 0);
      head.rotation.z = -0.38;
      head.castShadow = true;
      group.add(head);
      addSphere(0.025, 0.73).position.set(0.14, 0.76, 0.08);
    }
    group.scale.setScalar(0.88);
    group.position.copy(this.positionFor(square));
    return group;
  }

  private positionFor(square: Square): THREE.Vector3 {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    return new THREE.Vector3((file - 3.5) * 1.125, 0.12, (3.5 - rank) * 1.125);
  }

  private resize(): void {
    const bounds = this.renderer.domElement.parentElement?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    this.camera.aspect = bounds.width / bounds.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(bounds.width, bounds.height, false);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    if (this.renderer.domElement.clientWidth === 0) return;
    const now = performance.now();
    for (let index = this.animations.length - 1; index >= 0; index -= 1) {
      const animation = this.animations[index];
      const progress = Math.min((now - animation.started) / 340, 1);
      const eased = 1 - (1 - progress) ** 3;
      animation.mesh.position.lerpVectors(animation.from, animation.to, eased);
      animation.mesh.position.y += Math.sin(progress * Math.PI) * 0.48;
      if (progress === 1) this.animations.splice(index, 1);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
