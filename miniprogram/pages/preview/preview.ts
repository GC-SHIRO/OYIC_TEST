// 预览角色卡页面（从 chat 页面接收角色数据，或查看已有卡片）

import type {
  ICharacterCard,
  ICharacterInfo,
} from '../../types/character';
import { getCharacter, saveCharacter, fetchCharacterFromCloud, PLACEHOLDER_IMAGE } from '../../services/storage';
import { uploadImagesToCloud } from '../../services/image';
import { exportCharacterCard, saveImageToAlbum } from '../../services/exportImage';

// 可编辑的 section 标识
type EditSectionKey =
  | 'basicInfo'
  | 'introduction'
  | 'personalityTags'
  | 'appearance'
  | 'personality'
  | 'backstory'
  | 'storyline'
  | 'abilities'
  | 'relationships'
  | 'radar';

Page({
  data: {
    characterId: '',
    readonly: false,
    loading: true,
    isCompleting: false,
    isNavigating: false,
    activeTab: 'profile',
    galleryImages: [] as string[],
    uploadingGallery: false,
    isGalleryDeleteMode: false,
    character: {} as ICharacterInfo,
    /** 角色卡状态：incomplete | completed */
    characterStatus: 'incomplete' as 'incomplete' | 'completed',
    /** 当前处于编辑状态的 section，空字符串表示未编辑 */
    editingSection: '' as EditSectionKey | '',
    /** 底部轻提示（保存成功） */
    saveTipVisible: false,
    saveTipText: '',
    /** 当前聚焦的 input，解决 CSS focus 不稳定问题 */
    focusedInputPath: '',
    /** 当前聚焦的 tag 输入框索引，-1 表示无 */
    focusedTagIndex: -1,
  },

  saveTipTimer: 0 as number,

  onLoad(options: { characterId?: string; readonly?: string }) {
    const characterId = options.characterId || '';
    const readonly = options.readonly === 'true';

    this.setData({ characterId, readonly });

    if (!characterId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
      return;
    }

    // 先从本地缓存快速显示，然后从云端获取最新
    this.loadCharacterDetail(characterId);
  },

  /** 将六维图 0~1 旧数据转为 0~100 存储，便于统一展示与编辑
   * todo：删档之后可以删除本函数及相关兼容逻辑
   */
  normalizeRadarTo100(char: ICharacterInfo): ICharacterInfo {
    if (!char?.radar) return char;
    const r = char.radar;
    const to100 = (v: number) => (v != null && v <= 1 ? Math.round(v * 100) : (v ?? 50));
    return {
      ...char,
      radar: {
        extroversion: to100(r.extroversion),
        rationality: to100(r.rationality),
        kindness: to100(r.kindness),
        courage: to100(r.courage),
        openness: to100(r.openness),
        responsibility: to100(r.responsibility),
      },
    };
  },

  // 加载角色详情（云端优先）
  async loadCharacterDetail(characterId: string) {
    // 先尝试本地缓存快速渲染
    const localCard = getCharacter(characterId);
    
    if (localCard?.characterInfo?.name) {
      const char = this.normalizeRadarTo100(localCard.characterInfo);
      this.setData({
        
        character: char, 
        characterStatus: localCard.status || 'incomplete',
       
        galleryImages: Array.isArray(localCard.gallery) ? localCard.gallery : [],
        loading: false,
      
      });
      setTimeout(() => this.drawRadarChart(), 300);
    }

    // 从云端拉取最新数据
    const cloudCard = await fetchCharacterFromCloud(characterId);
    if (cloudCard?.characterInfo?.name) {
      const char = this.normalizeRadarTo100(cloudCard.characterInfo);
      this.setData({
        
        character: char, 
        characterStatus: cloudCard.status || 'incomplete',
       
        galleryImages: Array.isArray(cloudCard.gallery) ? cloudCard.gallery : [],
        loading: false,
      
      });
      setTimeout(() => this.drawRadarChart(), 300);
    } else if (!localCard?.characterInfo?.name) {
      this.setData({ loading: false });
      wx.showToast({ title: '未找到角色数据', icon: 'none' });
    }
  },

  onSwitchTab(e: WechatMiniprogram.TouchEvent) {
    const tab = String(e.currentTarget.dataset.tab || 'profile');
    if (tab !== 'profile' && tab !== 'gallery') return;
    this.setData({ activeTab: tab, isGalleryDeleteMode: false });
    if (tab === 'profile') {
      setTimeout(() => this.drawRadarChart(), 100);
    }
  },

  async onAddGalleryImage() {
    const { uploadingGallery, galleryImages } = this.data;
    if (uploadingGallery) return;

    const remain = Math.max(0, 20 - (galleryImages?.length || 0));
    if (remain <= 0) {
      wx.showToast({ title: '画廊最多 20 张图片', icon: 'none' });
      return;
    }

    try {
      const chooseRes = await wx.chooseImage({
        count: Math.min(9, remain),
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });

      const tempPaths = chooseRes.tempFilePaths || [];
      if (!tempPaths.length) return;

      this.setData({ uploadingGallery: true });
      wx.showLoading({ title: '上传中...', mask: true });

      const fileIDs = await uploadImagesToCloud(tempPaths, 'character_gallery');
      const nextGallery = [...(galleryImages || []), ...fileIDs];
      this.setData({ galleryImages: nextGallery });
      await this.syncCharacterToCloud();
      this.showSaveTip('画廊已保存到云端');
    } catch (error: any) {
      if (error?.errMsg && String(error.errMsg).includes('cancel')) {
        return;
      }
      wx.showToast({ title: '上传失败，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ uploadingGallery: false });
    }
  },

  onPreviewGalleryImage(e: WechatMiniprogram.TouchEvent) {
    if (this.data.isGalleryDeleteMode) return;
    const url = String(e.currentTarget.dataset.url || '');
    const { galleryImages } = this.data;
    if (!url) return;
    wx.previewImage({
      current: url,
      urls: galleryImages || [],
    });
  },

  onGalleryLongPress() {
    if (!this.data.isGalleryDeleteMode) {
      this.setData({ isGalleryDeleteMode: true });
    }
  },

  onExitGalleryDeleteMode() {
    this.setData({ isGalleryDeleteMode: false });
  },

  onGalleryDeleteTap(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const { galleryImages } = this.data;
    if (!Array.isArray(galleryImages) || Number.isNaN(index) || index < 0 || index >= galleryImages.length) return;

    wx.showModal({
      title: '删除图片',
      content: '确定从角色画廊中删除这张图片吗？',
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return;
        const nextGallery = galleryImages.filter((_, i) => i !== index);
        this.setData({
          galleryImages: nextGallery,
          isGalleryDeleteMode: nextGallery.length > 0,
        });
        await this.syncCharacterToCloud();
        this.showSaveTip('已从画廊删除');
      },
    });
  },

  // 绘制性格六维雷达图
  drawRadarChart() {
    const radar = this.data.character.radar;
    if (!radar) return;

    const query = this.createSelectorQuery();
    query.select('#radarCanvas')
      .fields({ node: true, size: true })
      .exec((res: any) => {
        if (!res[0]) return;

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);

        const w = res[0].width;
        const h = res[0].height;
        const cx = w / 2;
        const cy = h / 2;
        const maxR = Math.min(cx, cy) - 30;
        const levels = 5;
        const labels = ['外向度', '理智度', '善良度', '胆识度', '开放度', '责任感'];
        const raw = [
          radar.extroversion, radar.rationality, radar.kindness,
          radar.courage, radar.openness, radar.responsibility
        ];
        const values = raw.map(v => (v != null && v > 1 ? v / 100 : (v ?? 0.5)));
        const sides = 6;
        const angleStep = (Math.PI * 2) / sides;
        const startAngle = -Math.PI / 2;

        const getPoint = (i: number, r: number) => ({
          x: cx + r * Math.cos(startAngle + i * angleStep),
          y: cy + r * Math.sin(startAngle + i * angleStep)
        });

        // 绘制背景网格
        for (let lv = 1; lv <= levels; lv++) {
          const r = (maxR / levels) * lv;
          ctx.beginPath();
          for (let i = 0; i < sides; i++) {
            const p = getPoint(i, r);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.strokeStyle = '#e5e7eb';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // 绘制轴线
        for (let i = 0; i < sides; i++) {
          const p = getPoint(i, maxR);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = '#d1d5db';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }

        // 绘制数据区域
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
          const r = maxR * values[i];
          const p = getPoint(i, r);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();

        const gradient = ctx.createLinearGradient(cx - maxR, cy - maxR, cx + maxR, cy + maxR);
        gradient.addColorStop(0, 'rgba(156, 163, 175, 0.3)');
        gradient.addColorStop(1, 'rgba(75, 85, 99, 0.15)');
        ctx.fillStyle = gradient;
        ctx.fill();

        const strokeGrad = ctx.createLinearGradient(cx - maxR, cy - maxR, cx + maxR, cy + maxR);
        strokeGrad.addColorStop(0, '#9ca3af');
        strokeGrad.addColorStop(1, '#4b5563');
        ctx.strokeStyle = strokeGrad;
        ctx.lineWidth = 2;
        ctx.stroke();

        // 绘制数据点
        for (let i = 0; i < sides; i++) {
          const r = maxR * values[i];
          const p = getPoint(i, r);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#4b5563';
          ctx.fill();
        }

        // 绘制标签
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = '#4b5563';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < sides; i++) {
          const p = getPoint(i, maxR + 18);
          ctx.fillText(labels[i], p.x, p.y);
        }
      });
  },

  /** 校验当前 section 是否有必填项为空，返回错误提示或空字符串 */
  validateSectionEmpty(key: EditSectionKey): string {
    const c = this.data.character;
    if (!c) return '';

    const empty = (s: string | undefined) => !s || !String(s).trim();

    switch (key) {
      case 'basicInfo':
        if (empty(c.name)) return '姓名不能为空';
        if (empty(c.gender)) return '性别不能为空';
        if (empty(c.species)) return '物种不能为空';
        break;
      case 'introduction':
        break;
      case 'personalityTags':
        const tags = (c.personalityTags || []).filter(t => !empty(t));
        if (!tags.length) return '请至少添加一个性格标签';
        break;
      case 'appearance':
        if (empty(c.appearance?.hairColor)) return '发色不能为空';
        if (empty(c.appearance?.eyeColor)) return '瞳色不能为空';
        break;
      case 'personality':
        if (empty(c.personality)) return '性格描述不能为空';
        break;
      case 'backstory':
        if (empty(c.backstory)) return '角色背景不能为空';
        break;
      case 'abilities':
        if (c.abilities?.length) {
          for (const a of c.abilities) {
            if (empty(a.name)) return '能力名称不能为空';
            if (empty(a.description)) return '能力描述不能为空';
          }
        }
        break;
      case 'relationships':
        if (c.relationships?.length) {
          for (const r of c.relationships) {
            if (empty(r.character)) return '关系角色名不能为空';
            if (empty(r.relation)) return '关系描述不能为空';
          }
        }
        break;
      case 'radar':
        if (c.radar) {
          const keys: (keyof typeof c.radar)[] = ['extroversion', 'rationality', 'kindness', 'courage', 'openness', 'responsibility'];
          for (const k of keys) {
            const v = c.radar[k];
            if (v == null || typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 100) return '六维图数值须为 0~100 的整数';
          }
        }
        break;
      case 'storyline':
        break;
    }
    return '';
  },

  /** 添加性格标签 */
  onAddPersonalityTag() {
    const c = JSON.parse(JSON.stringify(this.data.character));
    if (!Array.isArray(c.personalityTags)) c.personalityTags = [];
    c.personalityTags.push('');
    this.setData({ character: c });
  },

  /** tag 输入框聚焦：高亮对应 wrapper */
  onTagFocus(e: WechatMiniprogram.BaseEvent) {
    const index = (e.currentTarget.dataset as any).index as number;
    this.setData({ focusedTagIndex: index });
  },

  /** tag 输入框失焦：清除高亮 */
  onTagBlur() {
    this.setData({ focusedTagIndex: -1 });
  },

  /** 删除自定义外观属性 */
  onDeleteAppearanceAttr(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number;
    const c = JSON.parse(JSON.stringify(this.data.character));
    if (!Array.isArray(c.appearance?.customAttrs)) return;
    c.appearance.customAttrs.splice(index, 1);
    this.setData({ character: c });
  },

  /** 切换自定义外观属性的锁定状态 */
  onToggleAppearanceAttrLock(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number;
    const c = JSON.parse(JSON.stringify(this.data.character));
    if (!Array.isArray(c.appearance?.customAttrs)) return;
    c.appearance.customAttrs[index].locked = !c.appearance.customAttrs[index].locked;
    this.setData({ character: c });
  },

  /** 切换编辑模式：点击「编辑」进入编辑，点击「完成编辑」保存并同步云端 */
  onToggleEdit(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset.section || '') as EditSectionKey;
    const { editingSection } = this.data;
    if (!key) return;

    if (editingSection === key) {
      let c = this.data.character;
      if (key === 'personalityTags' && Array.isArray(c.personalityTags)) {
        c = { ...c, personalityTags: c.personalityTags.filter(t => t && String(t).trim()) };
        this.setData({ character: c });
      }
      const err = this.validateSectionEmpty(key);
      if (err) {
        wx.showToast({ title: err, icon: 'none' });
        return;
      }
      // 完成编辑：退出编辑模式并同步云端
      this.setData({ editingSection: '' });
      console.log('[preview] 保存内容', { section: key, character: this.data.character });
      this.syncCharacterToCloud();
      if (key === 'radar') setTimeout(() => this.drawRadarChart(), 100);
    } else {
      // 进入编辑模式
      this.setData({ editingSection: key });
    }
  },

  /** 点击屏幕隐藏底部轻提示 */
  handleHideToast() {
    this.hideSaveTip();
  },

  showSaveTip(text: string) {
    if (this.saveTipTimer) {
      clearTimeout(this.saveTipTimer);
      this.saveTipTimer = 0;
    }
    this.setData({ saveTipVisible: true, saveTipText: text });
    this.saveTipTimer = setTimeout(() => {
      this.setData({ saveTipVisible: false });
      this.saveTipTimer = 0;
    }, 1800) as unknown as number;
  },

  hideSaveTip() {
    if (!this.data.saveTipVisible) return;
    if (this.saveTipTimer) {
      clearTimeout(this.saveTipTimer);
      this.saveTipTimer = 0;
    }
    this.setData({ saveTipVisible: false });
  },

  /** 聚焦输入框 */
  onInputFocus(e: WechatMiniprogram.BaseEvent) {
    const { path, index, subfield } = e.currentTarget.dataset;
    let focusKey = path || '';
    if (typeof index !== 'undefined') focusKey += `-${index}`;
    if (subfield) focusKey += `-${subfield}`;
    this.setData({ focusedInputPath: focusKey });
  },

  /** 失焦输入框 */
  onInputBlur() {
    this.setData({ focusedInputPath: '' });
  },

  /** 字段输入时更新本地 character */
  onFieldInput(e: WechatMiniprogram.Input) {
    const { path, index, subfield } = e.currentTarget.dataset as {
      path?: string;
      index?: number;
      subfield?: string;
    };
    const value = e.detail.value;
    if (!path) return;

    const character = JSON.parse(JSON.stringify(this.data.character));
    if (index !== undefined && index !== null) {
      // 支持嵌套路径数组，如 'appearance.customAttrs'
      const parts = path.split('.');
      let parent: any = character;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!parent[parts[i]]) parent[parts[i]] = {};
        parent = parent[parts[i]];
      }
      const arr = parent[parts[parts.length - 1]];
      if (!arr || !Array.isArray(arr)) return;
      if (subfield) {
        if (!arr[index]) arr[index] = {};
        arr[index] = { ...arr[index], [subfield]: value };
      } else {
        arr[index] = value;
      }
    } else {
      const parts = path.split('.');
      let target: any = character;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!target[p]) target[p] = {};
        target = target[p];
      }
      // 六维图数值：0~100 整数，雷达图绘制时会除以 100
      let finalValue: string | number = value;
      if (path.startsWith('radar.')) {
        if (value === '') {
          finalValue = '';
        } else {
          const num = Number(value);
          if (Number.isNaN(num)) {
            finalValue = 0;
          } else if (num < 0) {
            finalValue = 0;
          } else if (num > 100) {
            finalValue = 100;
          } else {
            finalValue = Math.round(num);
          }
        }
      }
      target[parts[parts.length - 1]] = finalValue;
    }
    this.setData({ character });
  },

  /** 同步角色卡到云端（编辑完成后调用） */
  async syncCharacterToCloud() {
    const { character, characterId, galleryImages } = this.data;
    if (!characterId) return;

    const card = getCharacter(characterId);
    if (card) {
      try {
        card.characterInfo = character;
        card.gallery = Array.isArray(galleryImages) ? galleryImages : [];
        card.updatedAt = Date.now();
        saveCharacter(card);
        console.log('[preview] 上传成功', { characterId, character });
        this.showSaveTip('已保存到云端');
      } catch (error) {
        console.error('[preview] 上传失败', { characterId, error });
        wx.showToast({ title: '上传失败，请稍后重试', icon: 'none' });
      }
    }
  },

  onHide() {
    this.hideSaveTip();
  },

  onUnload() {
    if (this.saveTipTimer) {
      clearTimeout(this.saveTipTimer);
      this.saveTipTimer = 0;
    }
  },

  // 返回首页
  onBack() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  // 完成创建 → 标记 completed → 同步云端 → 弹窗 → 回首页
  async onComplete() {
    const { character, characterId, isCompleting, galleryImages } = this.data;

    if (!characterId) return;
    if (isCompleting) return;

    this.setData({ isCompleting: true });

    wx.showLoading({ title: '提交中...', mask: true });

    try {
      const settleRes = await wx.cloud.callFunction({
        name: 'difyChat',
        data: {
          action: 'settleGiveResultCharge',
          cardId: characterId,
        },
      });

      const settleResult = settleRes.result as any;
      if (settleResult.code !== 0) {
        this.setData({ isCompleting: false });
        wx.hideLoading();
        wx.showToast({
          title: settleResult.message || '扣费失败，请重试',
          icon: 'none',
        });
        return;
      }
    } catch (err) {
      this.setData({ isCompleting: false });
      wx.hideLoading();
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      return;
    }

    const card = getCharacter(characterId);
    if (card) {
      card.status = 'completed';
      card.characterInfo = character;
      card.gallery = Array.isArray(galleryImages) ? galleryImages : [];
      card.avatar = card.avatar || PLACEHOLDER_IMAGE;
      saveCharacter(card); // saveCharacter 内部会自动异步同步到云端
    } else {
      // 兜底：直接构建新卡保存
      const now = Date.now();
      const newCard: ICharacterCard = {
        id: characterId,
        createdAt: now,
        updatedAt: now,
        creatorId: getApp<IAppOption>().globalData.openId || '',
        status: 'completed',
        conversationId: '',
        avatar: PLACEHOLDER_IMAGE,
        gallery: Array.isArray(galleryImages) ? galleryImages : [],
        characterInfo: character,
      };
      saveCharacter(newCard);
    }

    wx.hideLoading();

    // 弹窗提示完成
    wx.showModal({
      title: '创建成功',
      content: '角色卡创建已完成！',
      showCancel: false,
      confirmText: '返回首页',
      success: () => {
        this.setData({ isCompleting: false });
        wx.switchTab({ url: '/pages/home/home' });
      },
    });
  },

  // 继续设计 - 点击后修改状态为 incomplete 并返回 chat 页面
  async onContinueDesign() {
    const { characterId, isNavigating } = this.data;
    if (!characterId || isNavigating) return;

    // 设置标志位防止重复点击
    this.setData({ isNavigating: true });

    const card = getCharacter(characterId);
    if (card) {
      card.status = 'incomplete';
      card.updatedAt = Date.now();
      saveCharacter(card);
    }

    // 发送同步消息给 Dify
    try {
      await wx.cloud.callFunction({
        name: 'difyChat',
        data: {
          action: 'chat',
          query: 'Sync',
          conversationId: card?.conversationId || '',
          cardId: characterId,
          inputs: {
            sync_card: card?.characterInfo || {},
          },
        },
      });
    } catch (err) {
      console.error('发送同步消息失败:', err);
    }

    wx.redirectTo({
      url: `/pages/chat/chat?characterId=${characterId}`,
    });
  },

  // 导出作品 - 用于已完成状态，显示功能开发中弹窗
  onExport() {
    const { character, galleryImages, loading } = this.data;
    
    if (loading) {
      wx.showToast({ title: '数据加载中', icon: 'none' });
      return;
    }

    if (!character || !character.name) {
      wx.showToast({ title: '角色数据不完整', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '生成图片中...', mask: true });

    setTimeout(async () => {
      try {
        const filePath = await exportCharacterCard(
          'exportCanvas',
          this,
          character,
          galleryImages || []
        );

        wx.hideLoading();

        wx.showModal({
          title: '导出成功',
          content: '是否保存到手机相册？',
          confirmText: '保存',
          cancelText: '取消',
          success: async (res) => {
            if (res.confirm) {
              await saveImageToAlbum(filePath);
            }
          },
        });
      } catch (err) {
        wx.hideLoading();
        console.error('导出失败:', err);
        wx.showToast({ title: '导出失败，请重试', icon: 'none' });
      }
    }, 100);
  },

});
