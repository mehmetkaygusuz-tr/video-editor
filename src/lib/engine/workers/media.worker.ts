import { VideoDecoderWrapper } from '../../videoCodecs';

// Phase 1: Zero-copy WebCodecs video operations (Thumbnail & tagging)
self.onmessage = async (e: MessageEvent) => {
  const { type, taskId, payload } = e.data;

  try {
    if (type === 'GENERATE_THUMBNAIL') {
      const { file, timeInSeconds } = payload;
      
      const decoder = new VideoDecoderWrapper();
      await decoder.load(file);
      
      const result = await decoder.seek(timeInSeconds || 0, { mode: 'fast_keyframe' });
      let imageBitmap: ImageBitmap | null = null;
      
      if (result && result.frame) {
        // Zero-copy transfer to ImageBitmap
        imageBitmap = await createImageBitmap(result.frame);
        result.frame.close();
      }
      
      decoder.dispose();

      self.postMessage({
        type: 'media_result',
        taskId,
        result: { imageBitmap },
        payload: { taskId, result: { imageBitmap } }
      });
    }
  } catch (error: any) {
    self.postMessage({
      type: 'media_error',
      taskId,
      error: error.message || String(error),
      payload: { taskId, error: error.message || String(error) }
    });
  }
};
