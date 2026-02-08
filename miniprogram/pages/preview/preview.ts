// 预览角色卡页面（从 chat 页面接收角色数据，或查看已有卡片）

import type {
  ICharacterCard,
  ICharacterInfo,
} from '../../types/character';
import { getCharacter, saveCharacter, fetchCharacterFromCloud, PLACEHOLDER_IMAGE } from '../../services/storage';

Page({
  data: {
    characterId: '',
    readonly: false,
    loading: true,
    character: {} as ICharacterInfo,
  },

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

  // 加载角色详情（云端优先）
  async loadCharacterDetail(characterId: string) {
    // 先尝试本地缓存快速渲染
    const localCard = getCharacter(characterId);
    if (localCard?.characterInfo?.name) {
      this.setData({ character: localCard.characterInfo, loading: false });
      setTimeout(() => this.drawRadarChart(), 300);
    }

    // 从云端拉取最新数据
    const cloudCard = await fetchCharacterFromCloud(characterId);
    if (cloudCard?.characterInfo?.name) {
      this.setData({ character: cloudCard.characterInfo, loading: false });
      setTimeout(() => this.drawRadarChart(), 300);
    } else if (!localCard?.characterInfo?.name) {
      this.setData({ loading: false });
      wx.showToast({ title: '未找到角色数据', icon: 'none' });
    }
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
        const values = [
          radar.extroversion, radar.rationality, radar.kindness,
          radar.courage, radar.openness, radar.responsibility
        ];
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

  // 返回
  onBack() {
    wx.navigateBack();
  },

  // 继续创作（返回 chat 页面）
  onContinue() {
    wx.navigateBack();
  },

  // 完成创建 → 标记 completed → 同步云端 → 弹窗 → 回首页
  onComplete() {
    const { character, characterId } = this.data;

    if (!characterId) return;

    const card = getCharacter(characterId);
    if (card) {
      card.status = 'completed';
      card.characterInfo = character;
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
        characterInfo: character,
      };
      saveCharacter(newCard);
    }

    // 弹窗提示完成
    wx.showModal({
      title: '创建成功',
      content: '角色卡创建已完成！',
      showCancel: false,
      confirmText: '返回首页',
      success: () => {
        wx.switchTab({ url: '/pages/home/home' });
      },
    });
  },

  // 已由 saveCharacter 统一管理
  updateCharacterList(_characterId: string) {},
});
