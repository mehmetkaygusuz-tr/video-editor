export const MEMORY_STRUCT = {
  PLAYHEAD: 0,
  ZOOM: 1,
  SCROLL_X: 2,
  SCROLL_Y: 3,
  DURATION: 4,
  IS_PLAYING: 5,
  CLIP_COUNT: 6,
  HEADER_SIZE: 10,
  CLIP_BLOCK_SIZE: 10
};

export class TimelineMemory {
  buffer: ArrayBuffer | SharedArrayBuffer;
  f32: Float32Array;
  i32: Int32Array;

  constructor(maxClips = 1000) {
    const totalFloats = MEMORY_STRUCT.HEADER_SIZE + (maxClips * MEMORY_STRUCT.CLIP_BLOCK_SIZE);
    
    // Güvenli COOP/COEP Fallback (Hata vermemesi için korumalı ArrayBuffer geçişi)
    if (typeof SharedArrayBuffer !== 'undefined') {
      try {
        this.buffer = new SharedArrayBuffer(totalFloats * 4);
      } catch (e) {
        this.buffer = new ArrayBuffer(totalFloats * 4);
      }
    } else {
      this.buffer = new ArrayBuffer(totalFloats * 4);
    }
    
    this.f32 = new Float32Array(this.buffer);
    this.i32 = new Int32Array(this.buffer);
  }

  get playhead() { return this.i32[MEMORY_STRUCT.PLAYHEAD] / 1000; }
  get zoom() { return this.f32[MEMORY_STRUCT.ZOOM]; }
  get scrollX() { return this.f32[MEMORY_STRUCT.SCROLL_X]; }
  get scrollY() { return this.f32[MEMORY_STRUCT.SCROLL_Y]; }
  get duration() { return this.f32[MEMORY_STRUCT.DURATION]; }
  get isPlaying() { return this.i32[MEMORY_STRUCT.IS_PLAYING] === 1; }
  get clipCount() { return this.i32[MEMORY_STRUCT.CLIP_COUNT]; }

  set playhead(sec: number) { this.i32[MEMORY_STRUCT.PLAYHEAD] = Math.floor(sec * 1000); }
  set zoom(v: number) { this.f32[MEMORY_STRUCT.ZOOM] = v; }
  set scrollX(v: number) { this.f32[MEMORY_STRUCT.SCROLL_X] = v; }
  set scrollY(v: number) { this.f32[MEMORY_STRUCT.SCROLL_Y] = v; }
  set duration(v: number) { this.f32[MEMORY_STRUCT.DURATION] = v; }
  set isPlaying(v: boolean) { this.i32[MEMORY_STRUCT.IS_PLAYING] = v ? 1 : 0; }
  set clipCount(v: number) { this.i32[MEMORY_STRUCT.CLIP_COUNT] = v; }

  getClipOffset(index: number) {
    return MEMORY_STRUCT.HEADER_SIZE + (index * MEMORY_STRUCT.CLIP_BLOCK_SIZE);
  }

  writeClip(index: number, data: { intId: number, trackIdx: number, startAt: number, duration: number, sourceOffset: number, colorInt: number, volume: number, selected: boolean }) {
    const offset = this.getClipOffset(index);
    this.i32[offset + 0] = data.intId;
    this.i32[offset + 1] = data.trackIdx;
    this.f32[offset + 2] = data.startAt;
    this.f32[offset + 3] = data.duration;
    this.f32[offset + 4] = data.sourceOffset;
    this.i32[offset + 5] = data.colorInt;
    this.f32[offset + 6] = data.volume;
    this.i32[offset + 7] = data.selected ? 1 : 0;
  }

  readClip(index: number) {
    const offset = this.getClipOffset(index);
    return {
      intId: this.i32[offset + 0],
      trackIdx: this.i32[offset + 1],
      startAt: this.f32[offset + 2],
      duration: this.f32[offset + 3],
      sourceOffset: this.f32[offset + 4],
      colorInt: this.i32[offset + 5],
      volume: this.f32[offset + 6],
      selected: this.i32[offset + 7] === 1,
    };
  }
}
