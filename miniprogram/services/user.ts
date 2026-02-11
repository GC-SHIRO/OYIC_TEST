/**
 * 用户服务 - 基于云开发
 * 管理用户登录、注册、信息更新等
 */

export interface ICloudUser {
  openId: string;
  nickname: string;
  avatar: string;
  balance: number;
  signature?: string;
  createdAt?: number;
  isNewUser?: boolean;
}

/**
 * 调用 login 云函数进行登录/注册
 */
export async function cloudLogin(nickname?: string, avatar?: string): Promise<ICloudUser> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'login',
      data: {
        nickname: nickname || '',
        avatar: avatar || '',
      },
    });

    const result = res.result as any;
    if (result.code === 0) {
      const userData: ICloudUser = {
        openId: result.data.openId,
        nickname: result.data.nickname || '创作者',
        avatar: result.data.avatar || '',
        balance: result.data.balance || 0,
        signature: result.data.signature || '',
        createdAt: result.data.createdAt,
        isNewUser: result.data.isNewUser,
      };

      // 保存到本地缓存
      wx.setStorageSync('cloudUserInfo', userData);
      return userData;
    } else {
      throw new Error(result.message || '登录失败');
    }
  } catch (err) {
    console.error('云函数登录失败:', err);
    throw err;
  }
}

/**
 * 更新用户昵称
 */
export async function updateNickname(nickname: string): Promise<boolean> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'updateUser',
      data: { nickname },
    });

    const result = res.result as any;
    if (result.code === 0) {
      // 同步更新本地缓存
      const cached = wx.getStorageSync('cloudUserInfo') || {};
      cached.nickname = nickname;
      wx.setStorageSync('cloudUserInfo', cached);
      return true;
    }
    return false;
  } catch (err) {
    console.error('更新昵称失败:', err);
    return false;
  }
}

/**
 * 更新用户个性签名
 */
export async function updateSignature(signature: string): Promise<boolean> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'updateUser',
      data: { signature },
    });

    const result = res.result as any;
    if (result.code === 0) {
      const cached = wx.getStorageSync('cloudUserInfo') || {};
      cached.signature = signature;
      wx.setStorageSync('cloudUserInfo', cached);
      return true;
    }
    return false;
  } catch (err) {
    console.error('更新签名失败:', err);
    return false;
  }
}

/**
 * 上传头像到云存储并更新用户信息
 */
export async function uploadAvatar(tempFilePath: string): Promise<string> {
  try {
    // 上传到云存储
    const ext = tempFilePath.split('.').pop() || 'png';
    const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const uploadRes = await wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
    });

    const fileID = uploadRes.fileID;

    // 更新用户头像
    const res = await wx.cloud.callFunction({
      name: 'updateUser',
      data: { avatar: fileID },
    });

    const result = res.result as any;
    if (result.code === 0) {
      // 同步更新本地缓存
      const cached = wx.getStorageSync('cloudUserInfo') || {};
      cached.avatar = fileID;
      wx.setStorageSync('cloudUserInfo', cached);
      return fileID;
    }
    throw new Error('更新头像失败');
  } catch (err) {
    console.error('上传头像失败:', err);
    throw err;
  }
}

/**
 * 获取云端用户信息
 */
export async function getCloudUserInfo(): Promise<ICloudUser | null> {
  try {
    const db = wx.cloud.database();
    const res = await db.collection('users').where({
      _openid: '{openid}', // 云开发会自动替换
    }).get();

    if (res.data && res.data.length > 0) {
      const user = res.data[0] as any;
      return {
        openId: user._openid,
        nickname: user.nickname || '创作者',
        avatar: user.avatar || '',
        balance: user.balance || 0,
        signature: user.signature || '',
        createdAt: user.createdAt,
      };
    }
    return null;
  } catch (err) {
    console.error('获取用户信息失败:', err);
    return null;
  }
}

/**
 * 退出登录
 */
export function logout(): void {
  wx.removeStorageSync('cloudUserInfo');
}

/**
 * 检查本地是否有登录信息
 */
export function isLoggedIn(): boolean {
  const userInfo = wx.getStorageSync('cloudUserInfo');
  return !!(userInfo && userInfo.openId);
}

/**
 * 获取本地缓存的用户信息
 */
export function getLocalUserInfo(): ICloudUser | null {
  const userInfo = wx.getStorageSync('cloudUserInfo');
  if (userInfo && userInfo.openId) {
    return userInfo;
  }
  return null;
}
