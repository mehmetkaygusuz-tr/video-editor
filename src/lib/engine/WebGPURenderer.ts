export interface TransitionConfig {
  type: string; // 'crossfade' | 'fade' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'dip-black' | 'dip-white' | 'slide-left' | 'slide-right';
  progress: number; // 0.0 - 1.0
  feather?: number; // edge softness, default 0.03
}

export interface ColorGradingConfig {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
}

export class WebGPURenderer {
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  
  // Pipelines
  private singlePipeline: GPURenderPipeline | null = null;
  private singleBindGroupLayout: GPUBindGroupLayout | null = null;
  
  private transitionPipeline: GPURenderPipeline | null = null;
  private transitionBindGroupLayout: GPUBindGroupLayout | null = null;
  
  private sampler: GPUSampler | null = null;
  private isDeviceLost: boolean = false;
  private isInitializing: boolean = false;

  // Persistent Uniform Buffers (W3C Best Practice: avoid per-frame allocation/destroy)
  private singleUniformBuffer: GPUBuffer | null = null;
  private transitionUniformBuffer: GPUBuffer | null = null;
  
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
  }

  async init(): Promise<boolean> {
    if (this.isInitializing) return false;
    this.isInitializing = true;

    try {
      if (!navigator.gpu) {
        console.warn("[WebGPU] Not supported in this browser environment.");
        return false;
      }

      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance'
      });
      if (!adapter) {
        console.warn("[WebGPU] Could not acquire GPU adapter.");
        return false;
      }

      this.device = await adapter.requestDevice();
      this.isDeviceLost = false;

      // Monitor uncaptured GPU errors (W3C standard)
      this.device.addEventListener('uncapturederror', (event: any) => {
        console.warn('[WebGPU Uncaptured Error]', event.error?.message || event.error);
      });

      // Robust device.lost handling (W3C standard)
      this.device.lost.then((info) => {
        console.warn(`[WebGPU] GPUDevice lost: reason=${info.reason}, message=${info.message}`);
        this.isDeviceLost = true;
        this.singleUniformBuffer?.destroy();
        this.singleUniformBuffer = null;
        this.transitionUniformBuffer?.destroy();
        this.transitionUniformBuffer = null;
        this.singlePipeline = null;
        this.transitionPipeline = null;
        try {
          this.context?.unconfigure();
        } catch (_) {}
        if (info.reason !== 'destroyed') {
          // Attempt automatic recovery after brief cooldown
          setTimeout(() => this.init(), 1000);
        }
      });

      // Test WebGPU on a scratch OffscreenCanvas first to ensure canvas context is not locked if unsupported
      try {
        const testCanvas = new OffscreenCanvas(16, 16);
        const testCtx = testCanvas.getContext('webgpu');
        if (!testCtx) {
          console.warn("[WebGPU] OffscreenCanvas does not support webgpu in this environment.");
          return false;
        }
      } catch (e) {
        console.warn("[WebGPU] Test canvas error:", e);
        return false;
      }

      this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
      if (!this.context) {
        console.warn("[WebGPU] Failed to get webgpu context on canvas.");
        return false;
      }

      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format,
        colorSpace: 'srgb',
        alphaMode: 'premultiplied',
      });

      // --- Common WGSL Shaders with Color Science (Linear sRGB <-> Oklab) ---
      const commonWGSL = `
        struct VertexOutput {
          @builtin(position) Position: vec4<f32>,
          @location(0) fragUV: vec2<f32>,
        };

        @vertex
        fn main_v(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
          var pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
            vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
          );
          var uv = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
            vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0)
          );

          var output: VertexOutput;
          output.Position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
          output.fragUV = uv[VertexIndex];
          return output;
        }

        // Linear sRGB to Oklab
        fn lin_srgb_to_oklab(c: vec3<f32>) -> vec3<f32> {
          let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
          let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
          let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;

          let l_ = pow(max(l, 0.0), 1.0/3.0);
          let m_ = pow(max(m, 0.0), 1.0/3.0);
          let s_ = pow(max(s, 0.0), 1.0/3.0);

          return vec3<f32>(
            0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
            1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
            0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
          );
        }

        // Oklab to Linear sRGB
        fn oklab_to_lin_srgb(c: vec3<f32>) -> vec3<f32> {
          let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
          let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
          let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;

          let l = l_*l_*l_;
          let m = m_*m_*m_;
          let s = s_*s_*s_;

          return vec3<f32>(
            +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
          );
        }

        // Standard Display Gamma
        fn gamma(c: vec3<f32>) -> vec3<f32> {
          let a = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
          let b = 12.92 * c;
          let mask = vec3<f32>(
            select(0.0, 1.0, c.r >= 0.0031308),
            select(0.0, 1.0, c.g >= 0.0031308),
            select(0.0, 1.0, c.b >= 0.0031308)
          );
          return mix(b, a, mask);
        }

        // Apply Oklab color grading
        fn apply_grading(rgb: vec3<f32>, brightness: f32, contrast: f32, saturation: f32, temperature: f32, tint: f32) -> vec3<f32> {
          let ok = lin_srgb_to_oklab(rgb);
          var L = (ok.x - 0.5) * contrast + 0.5 + brightness;
          var a = (ok.y + temperature * 0.1) * saturation;
          var b = (ok.z + tint * 0.1) * saturation;
          return oklab_to_lin_srgb(vec3<f32>(L, a, b));
        }
      `;

      // --- 1. Single Frame Pipeline ---
      const singleShaderCode = `
        ${commonWGSL}

        struct SingleUniforms {
          brightness: f32,
          contrast: f32,
          saturation: f32,
          temperature: f32,
          tint: f32,
          pad1: f32,
          pad2: f32,
          pad3: f32,
        };

        @group(0) @binding(0) var<uniform> u: SingleUniforms;
        @group(0) @binding(1) var mySampler: sampler;
        @group(0) @binding(2) var myTexture: texture_external;

        @fragment
        fn main_f(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
          let sample = textureSampleBaseClampToEdge(myTexture, mySampler, fragUV);
          let graded = apply_grading(sample.rgb, u.brightness, u.contrast, u.saturation, u.temperature, u.tint);
          return vec4<f32>(gamma(clamp(graded, vec3<f32>(0.0), vec3<f32>(1.0))), sample.a);
        }
      `;

      const singleModule = this.device.createShaderModule({ code: singleShaderCode });
      this.singleBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        ],
      });

      this.device.pushErrorScope('validation');
      this.singlePipeline = await this.device.createRenderPipelineAsync({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.singleBindGroupLayout]
        }),
        vertex: { module: singleModule, entryPoint: 'main_v' },
        fragment: { module: singleModule, entryPoint: 'main_f', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      const singleValError = await this.device.popErrorScope();
      if (singleValError) {
        console.warn('[WebGPU] Single pipeline validation warning:', singleValError.message);
      }

      // --- 2. Dual-Texture Transition Pipeline ---
      // Supports Crossfade, Wipes (Left, Right, Up, Down), Dip to Color, and Slides
      const transitionShaderCode = `
        ${commonWGSL}

        struct TransitionUniforms {
          progress: f32,       // 0.0 to 1.0
          transitionType: u32, // 1: crossfade, 2: wipe-left, 3: wipe-right, 4: wipe-up, 5: wipe-down, 6: dip-black, 7: dip-white, 8: slide-left, 9: slide-right
          feather: f32,        // edge feather softness (0.01 - 0.15)
          aspectRatioMode: u32,// 0: fit/contain, 1: fill/cover
          // Grading for Clip 1
          b1: f32, c1: f32, s1: f32, t1: f32,
          tint1: f32,
          // Grading for Clip 2
          b2: f32, c2: f32, s2: f32,
          t2: f32, tint2: f32, pad1: f32, pad2: f32
        };

        @group(0) @binding(0) var<uniform> tu: TransitionUniforms;
        @group(0) @binding(1) var mySampler: sampler;
        @group(0) @binding(2) var textureA: texture_external;
        @group(0) @binding(3) var textureB: texture_external;

        @fragment
        fn main_transition_f(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
          let p = clamp(tu.progress, 0.0, 1.0);
          let f = max(0.001, tu.feather);
          
          var uvA = fragUV;
          var uvB = fragUV;

          // Slide transitions shift the UV coordinates
          if (tu.transitionType == 8u) {
            // Slide Left: A shifts left [0 -> -1], B enters from right [1 -> 0]
            uvA = fragUV + vec2<f32>(p, 0.0);
            uvB = fragUV - vec2<f32>(1.0 - p, 0.0);
          } else if (tu.transitionType == 9u) {
            // Slide Right: A shifts right [0 -> 1], B enters from left [-1 -> 0]
            uvA = fragUV - vec2<f32>(p, 0.0);
            uvB = fragUV + vec2<f32>(1.0 - p, 0.0);
          }

          let sampleA = textureSampleBaseClampToEdge(textureA, mySampler, clamp(uvA, vec2<f32>(0.0), vec2<f32>(1.0)));
          let sampleB = textureSampleBaseClampToEdge(textureB, mySampler, clamp(uvB, vec2<f32>(0.0), vec2<f32>(1.0)));

          let colorA = apply_grading(sampleA.rgb, tu.b1, tu.c1, tu.s1, tu.t1, tu.tint1);
          let colorB = apply_grading(sampleB.rgb, tu.b2, tu.c2, tu.s2, tu.t2, tu.tint2);

          var blendedLinear = colorA;

          // Transition algorithms
          if (tu.transitionType == 1u) {
            // Perceptually uniform Crossfade in Oklab space
            let okA = lin_srgb_to_oklab(colorA);
            let okB = lin_srgb_to_oklab(colorB);
            let okMix = mix(okA, okB, p);
            blendedLinear = oklab_to_lin_srgb(okMix);
          } 
          else if (tu.transitionType == 2u) {
            // Wipe Left-to-Right
            let mask = smoothstep(p - f, p + f, fragUV.x);
            blendedLinear = mix(colorB, colorA, mask);
          } 
          else if (tu.transitionType == 3u) {
            // Wipe Right-to-Left
            let mask = smoothstep((1.0 - p) - f, (1.0 - p) + f, 1.0 - fragUV.x);
            blendedLinear = mix(colorB, colorA, mask);
          } 
          else if (tu.transitionType == 4u) {
            // Wipe Up (bottom to top)
            let mask = smoothstep((1.0 - p) - f, (1.0 - p) + f, 1.0 - fragUV.y);
            blendedLinear = mix(colorB, colorA, mask);
          } 
          else if (tu.transitionType == 5u) {
            // Wipe Down (top to bottom)
            let mask = smoothstep(p - f, p + f, fragUV.y);
            blendedLinear = mix(colorB, colorA, mask);
          } 
          else if (tu.transitionType == 6u) {
            // Dip to Black
            if (p < 0.5) {
              blendedLinear = mix(colorA, vec3<f32>(0.0), p * 2.0);
            } else {
              blendedLinear = mix(vec3<f32>(0.0), colorB, (p - 0.5) * 2.0);
            }
          } 
          else if (tu.transitionType == 7u) {
            // Dip to White
            if (p < 0.5) {
              blendedLinear = mix(colorA, vec3<f32>(1.0), p * 2.0);
            } else {
              blendedLinear = mix(vec3<f32>(1.0), colorB, (p - 0.5) * 2.0);
            }
          } 
          else if (tu.transitionType == 8u || tu.transitionType == 9u) {
            // Slide selection based on screen boundary
            if (tu.transitionType == 8u) {
              blendedLinear = select(colorB, colorA, fragUV.x < (1.0 - p));
            } else {
              blendedLinear = select(colorA, colorB, fragUV.x < p);
            }
          }

          let alpha = mix(sampleA.a, sampleB.a, p);
          return vec4<f32>(gamma(clamp(blendedLinear, vec3<f32>(0.0), vec3<f32>(1.0))), alpha);
        }
      `;

      const transitionModule = this.device.createShaderModule({ code: transitionShaderCode });
      this.transitionBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        ],
      });

      this.device.pushErrorScope('validation');
      this.transitionPipeline = await this.device.createRenderPipelineAsync({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.transitionBindGroupLayout]
        }),
        vertex: { module: transitionModule, entryPoint: 'main_v' },
        fragment: { module: transitionModule, entryPoint: 'main_transition_f', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      const transitionValError = await this.device.popErrorScope();
      if (transitionValError) {
        console.warn('[WebGPU] Transition pipeline validation warning:', transitionValError.message);
      }

      // Allocate persistent uniform buffers (32 bytes single, 64 bytes transition)
      this.singleUniformBuffer = this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.transitionUniformBuffer = this.device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.sampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      return true;
    } catch (err) {
      console.error("[WebGPU] Initialization failure:", err);
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  resize(width: number, height: number) {
    const maxDim = this.device?.limits.maxTextureDimension2D ?? 8192;
    const clampedW = Math.min(maxDim, Math.max(1, Math.round(width)));
    const clampedH = Math.min(maxDim, Math.max(1, Math.round(height)));
    const sizeChanged = this.canvas.width !== clampedW || this.canvas.height !== clampedH;
    if (sizeChanged) {
      this.canvas.width = clampedW;
      this.canvas.height = clampedH;
    }
    if (this.context && this.device && !this.isDeviceLost && sizeChanged) {
      try {
        const format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
          device: this.device,
          format,
          colorSpace: 'srgb',
          alphaMode: 'premultiplied',
        });
      } catch (err) {
        console.warn('[WebGPU] Reconfigure failed on resize:', err);
      }
    }
  }

  /**
   * Renders a single frame with Oklab color grading (Zero-Copy GPU import)
   */
  render(videoFrame: VideoFrame, gradingOptions?: ColorGradingConfig) {
    if (!this.device || !this.context || !this.singlePipeline || !this.singleBindGroupLayout || !this.sampler) return;

    const grading = {
      brightness: gradingOptions?.brightness ?? 0,
      contrast: gradingOptions?.contrast ?? 1,
      saturation: gradingOptions?.saturation ?? 1,
      temperature: gradingOptions?.temperature ?? 0,
      tint: gradingOptions?.tint ?? 0
    };

    const uniformData = new Float32Array([
      grading.brightness,
      grading.contrast,
      grading.saturation,
      grading.temperature,
      grading.tint,
      0, 0, 0 // Padding to 32 bytes
    ]);
    
    // Ensure persistent uniform buffer exists (32 bytes)
    if (!this.singleUniformBuffer) {
      this.singleUniformBuffer = this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.singleUniformBuffer, 0, uniformData);

    let externalTexture: GPUExternalTexture;
    try {
      externalTexture = this.device.importExternalTexture({ source: videoFrame });
    } catch (err) {
      console.warn('[WebGPU] importExternalTexture failed:', err);
      return;
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.singleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.singleUniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: externalTexture },
      ],
    });

    let textureView: GPUTextureView;
    try {
      textureView = this.context.getCurrentTexture().createView();
    } catch (err) {
      console.warn('[WebGPU] getCurrentTexture() skipped in render:', err);
      return;
    }

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    passEncoder.setPipeline(this.singlePipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(6, 1, 0, 0);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Hardware-accelerated dual-texture transition rendering directly in WebGPU VRAM.
   * Eliminates 2D canvas fallback stalls.
   */
  renderTransition(
    frameA: VideoFrame,
    frameB: VideoFrame,
    transition: TransitionConfig,
    gradingA?: ColorGradingConfig,
    gradingB?: ColorGradingConfig
  ) {
    if (!this.device || !this.context || !this.transitionPipeline || !this.transitionBindGroupLayout || !this.sampler) {
      return;
    }

    const mapTransitionType = (name: string): number => {
      switch (name.toLowerCase()) {
        case 'crossfade':
        case 'fade':
        case 'dissolve':
          return 1;
        case 'wipe-left':
        case 'wipeleft':
          return 2;
        case 'wipe-right':
        case 'wiperight':
          return 3;
        case 'wipe-up':
        case 'wipeup':
          return 4;
        case 'wipe-down':
        case 'wipedown':
          return 5;
        case 'dip-black':
        case 'dipblack':
          return 6;
        case 'dip-white':
        case 'dipwhite':
          return 7;
        case 'slide-left':
        case 'slideleft':
          return 8;
        case 'slide-right':
        case 'slideright':
          return 9;
        default:
          return 1; // Default to smooth crossfade
      }
    };

    const typeCode = mapTransitionType(transition.type);
    const progress = Math.max(0, Math.min(1, transition.progress));
    const feather = transition.feather ?? 0.04;

    const gA = {
      b: gradingA?.brightness ?? 0,
      c: gradingA?.contrast ?? 1,
      s: gradingA?.saturation ?? 1,
      t: gradingA?.temperature ?? 0,
      tint: gradingA?.tint ?? 0,
    };
    const gB = {
      b: gradingB?.brightness ?? 0,
      c: gradingB?.contrast ?? 1,
      s: gradingB?.saturation ?? 1,
      t: gradingB?.temperature ?? 0,
      tint: gradingB?.tint ?? 0,
    };

    // Uniform buffer: 16 floats = 64 bytes (perfectly 16-byte aligned)
    const uniformBufferData = new ArrayBuffer(64);
    const floatView = new Float32Array(uniformBufferData);
    const uintView = new Uint32Array(uniformBufferData);

    floatView[0] = progress;
    uintView[1] = typeCode;
    floatView[2] = feather;
    uintView[3] = 0; // aspect mode default fit

    // Grading Clip 1
    floatView[4] = gA.b;
    floatView[5] = gA.c;
    floatView[6] = gA.s;
    floatView[7] = gA.t;
    floatView[8] = gA.tint;

    // Grading Clip 2
    floatView[9] = gB.b;
    floatView[10] = gB.c;
    floatView[11] = gB.s;
    floatView[12] = gB.t;
    floatView[13] = gB.tint;
    floatView[14] = 0; // padding
    floatView[15] = 0; // padding

    // Ensure persistent transition uniform buffer exists (64 bytes)
    if (!this.transitionUniformBuffer) {
      this.transitionUniformBuffer = this.device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.transitionUniformBuffer, 0, uniformBufferData);

    // Zero-copy import of both frames simultaneously to GPU
    let texA: GPUExternalTexture;
    let texB: GPUExternalTexture;
    try {
      texA = this.device.importExternalTexture({ source: frameA });
      texB = this.device.importExternalTexture({ source: frameB });
    } catch (err) {
      console.warn('[WebGPU] importExternalTexture failed in renderTransition:', err);
      return;
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.transitionBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.transitionUniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: texA },
        { binding: 3, resource: texB },
      ],
    });

    let textureView: GPUTextureView;
    try {
      textureView = this.context.getCurrentTexture().createView();
    } catch (err) {
      console.warn('[WebGPU] getCurrentTexture() skipped in renderTransition:', err);
      return;
    }

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    passEncoder.setPipeline(this.transitionPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(6, 1, 0, 0);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  isReady(): boolean {
    return !!(this.device && !this.isDeviceLost && this.singlePipeline && this.transitionPipeline);
  }

  /**
   * Cleans up all GPU resources according to W3C WebGPU specification to prevent VRAM leaks.
   */
  destroy() {
    this.singleUniformBuffer?.destroy();
    this.singleUniformBuffer = null;
    this.transitionUniformBuffer?.destroy();
    this.transitionUniformBuffer = null;
    this.singlePipeline = null;
    this.transitionPipeline = null;
    try {
      this.context?.unconfigure();
    } catch (_) {}
    this.context = null;
    try {
      this.device?.destroy();
    } catch (_) {}
    this.device = null;
  }
}

