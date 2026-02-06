/// <reference path="./types/index.d.ts" />

interface ICloudUserInfo {
  openId: string;
  nickname: string;
  avatar: string;
  balance?: number;
  signature?: string;
  createdAt?: number;
}

interface IAppOption {
  globalData: {
    isLoggedIn: boolean;
    openId: string;
    userInfo?: ICloudUserInfo;
  };
  checkLoginStatus?: () => Promise<void>;
  refreshUserInfo?: (openId: string) => Promise<void>;
}