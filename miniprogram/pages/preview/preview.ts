// 预览角色卡页面

import type {
  ICharacterCard,
  ICharacterInfo,
} from '../../types/character';
import { saveCharacter } from '../../services/storage';

// 生成请求接口定义
interface IGenerateRequest {
  characterId: string;
  conversationHistory: any[];
}

interface IGenerateResponse {
  success: boolean;
  data?: ICharacterInfo;
  error?: string;
}

Page({
  data: {
    characterId: '',
    readonly: false,
    loading: true,
    character: {} as ICharacterInfo
  },

  onLoad(options: { characterId?: string; readonly?: string }) {
    const characterId = options.characterId || 'new';
    const readonly = options.readonly === 'true';
    
    this.setData({ characterId, readonly });
    
    if (readonly) {
      // 查看已有角色
      this.loadCharacterDetail(characterId);
    } else {
      // 生成新角色卡
      this.generateCharacterCard(characterId);
    }
  },

  // 加载角色详情
  loadCharacterDetail(characterId: string) {
    // 从本地存储加载角色卡
    const card: ICharacterCard | null = wx.getStorageSync(`character_${characterId}`) || null;
    
    if (card && card.characterInfo) {
      this.setData({ character: card.characterInfo, loading: false });
      this.drawRadarChart();
    } else {
      // 使用示例数据
      this.setData({
        character: this.getMockCharacter(),
        loading: false
      });
      this.drawRadarChart();
    }
  },

  // 生成角色卡
  async generateCharacterCard(characterId: string) {
    this.setData({ loading: true });

    try {
      // 获取对话历史
      const conversation = wx.getStorageSync(`conversation_${characterId}`) || [];
      
      // 调用生成API
      const response = await this.callGenerateAPI({
        characterId,
        conversationHistory: conversation
      });

      if (response.success && response.data) {
        this.setData({
          character: response.data,
          loading: false
        });
      } else {
        throw new Error(response.error || '生成失败');
      }
    } catch (error) {
      console.error('Generate character error:', error);
      
      // 模拟 API 响应
      this.setData({
        character: this.getMockCharacter(),
        loading: false
      });

      // 绘制雷达图
      this.drawRadarChart();
    }
  },

  /**
   * 调用生成API
   * 这是暴露的接口，用于对外确认生成请求
   * @param request 生成请求参数
   */
  async callGenerateAPI(request: IGenerateRequest): Promise<IGenerateResponse> {
    // TODO: 替换为实际的API调用
    // 示例请求格式：
    // const response = await wx.request({
    //   url: 'YOUR_API_ENDPOINT/generate',
    //   method: 'POST',
    //   header: {
    //     'Content-Type': 'application/json',
    //     'Authorization': 'Bearer YOUR_API_KEY'
    //   },
    //   data: request
    // });

    // 模拟API响应
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          data: this.getMockCharacter()
        });
      }, 2000);
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
        const values = [
          radar.extroversion, radar.rationality, radar.kindness,
          radar.courage, radar.openness, radar.responsibility
        ];
        const sides = 6;
        const angleStep = (Math.PI * 2) / sides;
        const startAngle = -Math.PI / 2;

        // 获取顶点坐标
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

        // 渐变填充
        const gradient = ctx.createLinearGradient(cx - maxR, cy - maxR, cx + maxR, cy + maxR);
        gradient.addColorStop(0, 'rgba(156, 163, 175, 0.3)');
        gradient.addColorStop(1, 'rgba(75, 85, 99, 0.15)');
        ctx.fillStyle = gradient;
        ctx.fill();

        // 描边
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

  // 获取模拟角色数据
  getMockCharacter(): ICharacterInfo {
    return {
      name: '丰川祥子',
      introduction: '原属丰川豪门的贵族少女，因家庭崩溃而蓬头垢面，以冷酷与理智将自己武装起来，带领Ave Mujica在残酷的世界中杀出一条血路。',
      gender: '女',
      constellation: '水瓶座',
      birthday: '2月14日',
      species: '人类',
      personalityTags: ['自尊高傲', '现实主义', '责任感', '破碎', '伪装', '掌控欲', '前富家千金'],
      appearance: {
        hairColor: '淡蓝银色渐变（月光色）',
        eyeColor: '金琥珀色',
        detail: '平日里（羽丘女子学园制服），她留着标志性的姬发式长发，气质优雅高贵，举手投足间流露着良好的教养，给人一种难以接近的"高岭之花"的印象。然而在私下打工或生活窘迫时，会显得疲惫且朴素。\n\n在Ave Mujica的舞台上化身为"Oblivionis"时，她身着繁复华丽的哥特风格演出服，佩戴遮住半张脸的精致假面，如同掌控命运的女神，散发着一种甚至带有攻击性的压倒性魅力。'
      },
      personality: '曾经的她天真烂漫、温柔且充满理想，是CRYCHIC的组建者和核心。但在经历了家庭破产、父亲酗酒等一系列残酷变故后，她的性格发生了剧变。\n\n现在的祥子是一个极度的现实主义者。她被迫抛弃了过去的软弱和天真，用冷酷和理智将自己武装起来。她自尊心极强，不愿向昔日好友展露自己的落魄，因此选择用决绝甚至伤人的方式切断了与过去的联系。',
      backstory: '原本出生于显赫的丰川家族，居住在豪华的欧式宅邸中，拥有无忧无虑的童年，并与青梅竹马若叶睦关系亲密。初中时期，凭着对音乐的热爱组建了乐队CRYCHIC，是高松灯等人的引路人。\n\n然而，父亲的商业失败导致家庭一夜之间崩塌，不仅失去了豪宅，还需要照顾酗酒颓废的父亲，生活跌入谷底。',
      storyline: '从《BanG Dream! It\'s MyGO!!!!!》的解散事件开始，祥子在雨中决绝地宣告CRYCHIC的终结，随后转学至羽丘女子学园。\n\n在《Ave Mujica》篇章中，她作为键盘手"Oblivionis"和乐队的实际领导者，戴上面具，试图将世界变为她的舞台，誓要将曾经失去的一切夺回来。',
      abilities: [
        { name: '绝对音感与作曲才华', description: '拥有极高的音乐天赋，能够创作出风格迥异的高质量乐曲。' },
        { name: '洞察与操纵', description: '能够敏锐地看穿他人的弱点和渴望，并利用这些来达成自己的目的。' },
        { name: '极强的抗压能力', description: '在家庭破碎的极端压力下依然能维持学业和乐队运营，展现出超乎常人的精神韧性。' }
      ],
      relationships: [
        { character: '高松灯', relation: '曾经的救赎对象 / 现已抛弃的过去' },
        { character: '若叶睦', relation: '青梅竹马 / 共犯 / 工具人' },
        { character: '长崎素世', relation: '纠缠不清的旧友 / 厌恶的对象' },
        { character: '三角初华', relation: '商业伙伴 / 相互利用的盟友' },
        { character: '八幡海铃', relation: '雇佣关系 / 值得信赖的战力' }
      ],
      radar: {
        extroversion: 0.6,
        rationality: 0.95,
        kindness: 0.3,
        courage: 0.9,
        openness: 0.5,
        responsibility: 0.9
      }
    };
  },

  // 选择模板（已移除）

  // 返回
  onBack() {
    wx.navigateBack();
  },

  // 继续创作
  onContinue() {
    const { characterId } = this.data;
    wx.navigateBack({
      success: () => {
        // 返回聊天页面继续创作
      }
    });
  },

  // 完成创建
  onComplete() {
    const { character, characterId } = this.data;
    const now = Date.now();

    // 构建角色卡完整存储结构
    const card: ICharacterCard = {
      id: characterId,
      createdAt: now,
      updatedAt: now,
      creatorId: getApp<IAppOption>().globalData.openId || '',
      status: 'completed',
      conversationId: characterId,
      avatar: '',
      characterInfo: character,
    };

    // 使用统一存储服务保存
    saveCharacter(card);

    wx.showToast({
      title: '创建成功',
      icon: 'success',
      duration: 1500,
      success: () => {
        setTimeout(() => {
          // 返回首页
          wx.switchTab({
            url: '/pages/home/home'
          });
        }, 1500);
      }
    });
  },

  // 更新角色列表（已由 saveCharacter 统一管理，保留兼容）
  updateCharacterList(characterId: string) {
    // 此方法已不再需要，saveCharacter 内部会自动维护 characterList
  }
});
