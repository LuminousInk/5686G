import { EquirectangularAdapter, utils } from '@photo-sphere-viewer/core'

// The stock adapter uses FileLoader and a blob URL, even with XMP disabled.
// These full equirectangular WebPs can be loaded through an ordinary image element.
export class DirectImageAdapter extends EquirectangularAdapter {
  override async loadTexture(panorama: string) {
    const img = await this.viewer.textureLoader.loadImage(panorama, undefined, panorama)
    return {
      panorama,
      texture: utils.createSizedTexture(img),
      panoData: utils.mergePanoData(img.width, img.height),
      cacheKey: panorama,
    }
  }
}
