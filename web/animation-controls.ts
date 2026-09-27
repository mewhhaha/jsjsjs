import type * as THREE from "three";
import {
  AnimationPlayer,
  type AnimationPlayOptions,
  type AnimationSampleOptions,
  type AnimationState,
} from "../src/animation.ts";

/** Browser clock and controls around the same absolute sampler used by the CLI. */
export class AnimationControls {
  private player: AnimationPlayer | undefined;
  private frame = 0;
  private previous = 0;
  private locked = false;
  private readonly bar = document.querySelector<HTMLElement>("#animation")!;
  private readonly select = document.querySelector<HTMLSelectElement>(
    "#animation-clip",
  )!;
  private readonly button = document.querySelector<HTMLButtonElement>(
    "#animation-play",
  )!;
  private readonly timeline = document.querySelector<HTMLInputElement>(
    "#animation-time",
  )!;
  private readonly label = document.querySelector<HTMLOutputElement>(
    "#animation-position",
  )!;
  private readonly speed = document.querySelector<HTMLSelectElement>(
    "#animation-speed",
  )!;
  private readonly loop = document.querySelector<HTMLInputElement>(
    "#animation-loop",
  )!;

  constructor(private readonly render: () => void) {
    this.select.addEventListener("change", () => {
      if (this.select.value) this.seek(this.select.value, 0);
      else this.reset();
    });
    this.button.addEventListener("click", () => {
      if (this.state().playing) this.pause();
      else {this.play(undefined, {
          speed: Number(this.speed.value),
          loop: this.loop.checked,
        });}
    });
    this.timeline.addEventListener(
      "input",
      () => this.seek(this.state().clip!, Number(this.timeline.value)),
    );
    for (const element of [this.speed, this.loop]) {
      element.addEventListener("change", () => {
        if (this.state().playing) {
          this.play(undefined, {
            speed: Number(this.speed.value),
            loop: this.loop.checked,
          });
        }
      });
    }
  }

  load(model: THREE.Object3D): void {
    const next = new AnimationPlayer(model);
    this.stopClock();
    this.player?.dispose();
    this.player = next;
    this.locked = false;
    this.select.replaceChildren(
      new Option("Authored pose", ""),
      ...next.clips.map((clip) => new Option(clip.name, clip.name)),
    );
    this.bar.hidden = next.clips.length === 0;
    this.refresh();
  }

  state(): AnimationState {
    return this.player?.state ??
      {
        clips: [],
        clip: null,
        time: 0,
        duration: 0,
        playing: false,
        loop: true,
        speed: 1,
      };
  }

  private requirePlayer(): AnimationPlayer {
    if (this.locked) {
      throw new Error(
        "Animation is locked while an export or capture is in progress.",
      );
    }
    if (!this.player) throw new Error("No model is ready to animate.");
    return this.player;
  }

  play(name?: string, options: AnimationPlayOptions = {}): AnimationState {
    const player = this.requirePlayer();
    player.play(name, options);
    this.stopClock();
    this.previous = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    this.refresh();
    this.render();
    return player.state;
  }

  private tick = (now: number) => {
    this.frame = 0;
    this.player?.update((now - this.previous) / 1000);
    this.previous = now;
    this.refresh();
    this.render();
    if (this.state().playing) this.frame = requestAnimationFrame(this.tick);
  };

  private stopClock(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  pause(): AnimationState {
    this.requirePlayer().pause();
    this.stopClock();
    this.refresh();
    return this.state();
  }

  seek(
    name: string,
    time: number,
    options: AnimationSampleOptions = {},
  ): AnimationState {
    const result = this.requirePlayer().seek(time, name, options);
    this.stopClock();
    this.refresh();
    this.render();
    return result;
  }

  reset(): AnimationState {
    this.requirePlayer().reset();
    this.stopClock();
    this.refresh();
    this.render();
    return this.state();
  }

  /** Pin the pose and prevent scrubbing while an asynchronous export is reading it. */
  freeze(authored = false): () => void {
    const player = this.requirePlayer();
    const state = player.state;
    this.pause();
    if (authored) player.reset();
    this.locked = true;
    this.refresh();
    return () => {
      // A hot reload owns its new player; never restore an old animation onto it.
      if (player !== this.player) return;
      this.locked = false;
      if (authored && state.clip) player.seek(state.time, state.clip);
      if (state.playing) {
        this.play(undefined, { loop: state.loop, speed: state.speed });
      }
      this.refresh();
      this.render();
    };
  }

  private refresh(): void {
    const state = this.state();
    this.select.value = state.clip ?? "";
    this.button.textContent = state.playing ? "Pause" : "Play";
    this.timeline.max = String(state.duration || 1);
    this.timeline.value = String(state.time);
    this.timeline.disabled = this.locked || !state.clip;
    this.label.value = `${state.time.toFixed(2)} / ${
      state.duration.toFixed(2)
    } s`;
    for (const element of [this.select, this.button, this.speed, this.loop]) {
      element.disabled = this.locked;
    }
  }
}
