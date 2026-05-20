import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayModeSystem } from '../client/src/editor/PlayModeSystem';

describe('PlayModeSystem', () => {
  it('restores transforms and removes objects added during play', () => {
    const scene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    box.name = 'Box';
    box.position.set(1, 2, 3);
    box.userData.tag = 'original';
    scene.add(box);

    const playMode = new PlayModeSystem(scene);
    playMode.play();

    box.position.set(9, 9, 9);
    box.visible = false;
    box.userData.tag = 'changed';

    const added = new THREE.Group();
    added.name = 'AddedAtRuntime';
    scene.add(added);

    playMode.stop();

    expect(box.position.toArray()).toEqual([1, 2, 3]);
    expect(box.visible).toBe(true);
    expect(box.userData.tag).toBe('original');
    expect(scene.getObjectByName('AddedAtRuntime')).toBeUndefined();
    expect(playMode.isStopped()).toBe(true);
    expect(playMode.getFrame()).toBe(0);
    expect(playMode.getElapsed()).toBe(0);
  });

  it('steps one frame at fixed timestep while paused', () => {
    const scene = new THREE.Scene();
    const playMode = new PlayModeSystem(scene);

    playMode.step();
    expect(playMode.isPaused()).toBe(true);

    const dt = playMode.update(0.5);
    expect(dt).toBeCloseTo(1 / 60);
    expect(playMode.getFrame()).toBe(1);
    expect(playMode.getElapsed()).toBeCloseTo(1 / 60);

    const pausedDt = playMode.update(0.5);
    expect(pausedDt).toBe(0);
    expect(playMode.getFrame()).toBe(1);
  });

  it('supports listener removal for play/stop events', () => {
    const scene = new THREE.Scene();
    const playMode = new PlayModeSystem(scene);
    let playCount = 0;
    let stopCount = 0;

    const onPlay = () => { playCount++; };
    const onStop = () => { stopCount++; };

    playMode.on('play', onPlay);
    playMode.on('stop', onStop);
    playMode.play();
    playMode.stop();

    playMode.off('play', onPlay);
    playMode.off('stop', onStop);
    playMode.play();
    playMode.stop();

    expect(playCount).toBe(1);
    expect(stopCount).toBe(1);
  });
});