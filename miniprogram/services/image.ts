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
