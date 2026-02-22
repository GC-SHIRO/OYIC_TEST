export async function compressImage(
  tempFilePath: string,
  maxSizeKB = 200
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileManager = wx.getFileSystemManager();
    fileManager.getFileInfo({
      filePath: tempFilePath,
      success: (info) => {
        const currentSizeKB = info.size / 1024;
        console.log(`[图片压缩] 原始大小: ${currentSizeKB.toFixed(2)}KB, 目标: ${maxSizeKB}KB`);
        if (currentSizeKB <= maxSizeKB) {
          console.log(`[图片压缩] 无需压缩，大小已满足要求`);
          resolve(tempFilePath);
          return;
        }
        compressWithQuality(tempFilePath, maxSizeKB, 90, resolve, reject);
      },
      fail: (err) => {
        console.error(`[图片压缩] 获取文件信息失败:`, err);
        reject(err);
      },
    });
  });
}

function compressWithQuality(
  tempFilePath: string,
  maxSizeKB: number,
  quality: number,
  resolve: (path: string) => void,
  reject: (err: any) => void
) {
  if (quality < 20) {
    console.log(`[图片压缩] 质量压缩到 ${quality}% 仍超限，开始缩放分辨率`);
    compressByScale(tempFilePath, maxSizeKB, 0.8, resolve, reject);
    return;
  }
  console.log(`[图片压缩] 质量压缩中... quality: ${quality}%`);
  wx.compressImage({
    src: tempFilePath,
    quality,
    success: (res) => {
      const fileManager = wx.getFileSystemManager();
      fileManager.getFileInfo({
        filePath: res.tempFilePath,
        success: (info) => {
          const currentSizeKB = info.size / 1024;
          console.log(`[图片压缩] 质量 ${quality}% -> ${currentSizeKB.toFixed(2)}KB`);
          if (currentSizeKB <= maxSizeKB) {
            console.log(`[图片压缩] 质量压缩成功！最终大小: ${currentSizeKB.toFixed(2)}KB`);
            resolve(res.tempFilePath);
          } else {
            compressWithQuality(tempFilePath, maxSizeKB, quality - 10, resolve, reject);
          }
        },
        fail: (err) => {
          console.error(`[图片压缩] 获取压缩后文件信息失败:`, err);
          compressByScale(tempFilePath, maxSizeKB, 0.8, resolve, reject);
        },
      });
    },
    fail: (err) => {
      console.error(`[图片压缩] wx.compressImage 失败:`, err);
      compressByScale(tempFilePath, maxSizeKB, 0.8, resolve, reject);
    },
  });
}

function compressByScale(
  tempFilePath: string,
  maxSizeKB: number,
  scale: number,
  resolve: (path: string) => void,
  reject: (err: any) => void
) {
  if (scale < 0.2) {
    console.warn(`[图片压缩] 缩放到 ${(scale * 100).toFixed(0)}% 仍超限，返回原图`);
    resolve(tempFilePath);
    return;
  }
  console.log(`[图片压缩] 分辨率缩放中... scale: ${(scale * 100).toFixed(0)}%`);
  wx.getImageInfo({
    src: tempFilePath,
    success: (info) => {
      const originalWidth = info.width;
      const originalHeight = info.height;
      const targetWidth = Math.floor(originalWidth * scale);
      const targetHeight = Math.floor(originalHeight * scale);
      console.log(`[图片压缩] 分辨率: ${originalWidth}x${originalHeight} -> ${targetWidth}x${targetHeight}`);

      const query = wx.createSelectorQuery();
      query.select('#compressCanvas').node((res) => {
        const canvas = res.node;
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        const image = canvas.createImage();
        image.src = tempFilePath;
        image.onload = () => {
          ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
          wx.canvasToTempFilePath({
            canvas,
            fileType: 'jpg',
            quality: 0.8,
            success: (result) => {
              const fileManager = wx.getFileSystemManager();
              fileManager.getFileInfo({
                filePath: result.tempFilePath,
                success: (fileInfo) => {
                  const currentSizeKB = fileInfo.size / 1024;
                  console.log(`[图片压缩] 缩放 ${(scale * 100).toFixed(0)}% -> ${currentSizeKB.toFixed(2)}KB`);
                  if (currentSizeKB <= maxSizeKB) {
                    console.log(`[图片压缩] 缩放压缩成功！最终大小: ${currentSizeKB.toFixed(2)}KB`);
                    resolve(result.tempFilePath);
                  } else {
                    compressByScale(tempFilePath, maxSizeKB, scale - 0.2, resolve, reject);
                  }
                },
                fail: (err) => {
                  console.error(`[图片压缩] 获取缩放后文件信息失败:`, err);
                  resolve(result.tempFilePath);
                },
              });
            },
            fail: (err) => {
              console.error(`[图片压缩] canvasToTempFilePath 失败:`, err);
              resolve(tempFilePath);
            },
          });
        };
        image.onerror = () => {
          console.error(`[图片压缩] canvas.createImage 加载失败`);
          resolve(tempFilePath);
        };
      });
      query.exec();
    },
    fail: (err) => {
      console.error(`[图片压缩] wx.getImageInfo 失败:`, err);
      resolve(tempFilePath);
    },
  });
}

/**
 * 上传图片到云存储，返回 fileID 数组
 */
export async function uploadImagesToCloud(
  tempFilePaths: string[],
  folder = 'chat_images'
): Promise<string[]> {
  const uploadTasks = tempFilePaths.map(async (tempFilePath) => {
    const ext = tempFilePath.split('.').pop() || 'png';
    const cloudPath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadRes = await wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
    });
    return uploadRes.fileID;
  });
  return Promise.all(uploadTasks);
}
