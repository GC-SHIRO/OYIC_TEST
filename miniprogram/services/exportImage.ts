import type { ICharacterInfo, IPersonalityRadar } from '../types/character';

// 微信小程序设计稿宽度为 750rpx，1rpx = 0.5px
// 导出图片宽度为 750px（2倍图）
const SCALE = 1; // rpx 转 px 的比例（750rpx = 750px）
const DPR = 2; // 设备像素比，用于高清输出

// 字体配置 - 使用系统自带的中文字体
const FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

// 样式配置 - 直接使用 rpx 数值，内部会自动转换为 px
// 整体字体缩小约15%
const STYLES = {
  page: {
    width: 750, // px
    padding: 32, // rpx -> px
    background: ['#f7f8fa', '#eef0f3'],
  },
  card: {
    background: '#ffffff',
    borderRadius: 40, // rpx
    borderWidth: 2, // rpx
    borderColor: 'rgba(229, 231, 235, 0.9)',
    shadowColor: 'rgba(17, 24, 39, 0.12)',
    shadowBlur: 40, // rpx
    shadowOffsetY: 18, // rpx
  },
  header: {
    background: ['#f9fafb', '#e5e7eb', '#cbd5e1'],
    padding: 64, // rpx
    horizontalPadding: 48, // rpx
  },
  body: {
    padding: 48, // rpx
  },
  characterName: {
    fontSize: 38, // rpx (原来是44)
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12, // rpx
  },
  characterIntro: {
    fontSize: 22, // rpx (原来是24)
    color: '#6b7280',
    lineHeight: 1.6,
  },
  sectionTitle: {
    fontSize: 20, // rpx (原来是22)
    fontWeight: '600',
    color: '#9ca3af',
    letterSpacing: 2, // rpx
    marginBottom: 14, // rpx
  },
  sectionDivider: {
    height: 2, // rpx
    marginVertical: 32, // rpx
  },
  infoItem: {
    fontSize: 24, // rpx (原来是28)
    labelColor: '#4b5563',
    valueColor: '#6b7280',
    marginBottom: 8, // rpx
  },
  personalityTag: {
    paddingVertical: 8, // rpx (原来是10)
    paddingHorizontal: 24, // rpx (原来是28)
    background: ['#f3f4f6', '#d1d5db'],
    color: '#111827',
    borderRadius: 40, // rpx
    fontSize: 22, // rpx (原来是26)
    fontWeight: '500',
    borderWidth: 2, // rpx
    borderColor: '#e5e7eb',
    gap: 16, // rpx
  },
  appearanceAttr: {
    dotSize: 20, // rpx (原来是24)
    dotBorderRadius: 10, // rpx (原来是12)
    dotBackground: ['#c0d0e8', '#e8e8f0'],
    labelFontSize: 22, // rpx (原来是26)
    labelColor: '#9ca3af',
    labelFontWeight: '500',
    valueFontSize: 24, // rpx (原来是28)
    valueColor: '#4b5563',
    gap: 16, // rpx
    marginBottom: 16, // rpx
  },
  appearanceDetail: {
    fontSize: 22, // rpx (原来是26)
    color: '#4b5563',
    lineHeight: 1.7,
    padding: 20, // rpx (原来是24)
    paddingHorizontal: 24, // rpx (原来是28)
    background: '#f9fafb',
    borderRadius: 24, // rpx
    borderLeftWidth: 6, // rpx
    borderLeftColor: '#9ca3af',
    marginTop: 16, // rpx
  },
  longText: {
    fontSize: 22, // rpx (原来是26)
    color: '#4b5563',
    lineHeight: 1.8,
  },
  abilityItem: {
    padding: 20, // rpx (原来是24)
    paddingHorizontal: 24, // rpx (原来是28)
    background: '#f9fafb',
    borderRadius: 24, // rpx
    borderLeftWidth: 6, // rpx
    borderLeftColor: '#9ca3af',
    gap: 20, // rpx
  },
  abilityName: {
    fontSize: 24, // rpx (原来是28)
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8, // rpx
  },
  abilityDesc: {
    fontSize: 22, // rpx (原来是26)
    color: '#6b7280',
    lineHeight: 1.6,
  },
  relationshipItem: {
    paddingVertical: 16, // rpx (原来是20)
    paddingHorizontal: 24, // rpx (原来是28)
    background: '#f9fafb',
    borderRadius: 24, // rpx
    gap: 16, // rpx (原来是20)
  },
  relCharacter: {
    fontSize: 24, // rpx (原来是28)
    fontWeight: '600',
    color: '#111827',
  },
  relArrow: {
    fontSize: 28, // rpx (原来是32)
    color: '#9ca3af',
  },
  relDesc: {
    fontSize: 22, // rpx (原来是26)
    color: '#6b7280',
  },
  radar: {
    size: 400, // rpx
    marginVertical: 20, // rpx
  },
  gallery: {
    borderRadius: 20, // rpx
    gap: 16, // rpx
    background: '#e5e7eb',
  },
};

// rpx 转 px
function rpx(val: number): number {
  return val * SCALE;
}

function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let currentLine = '';
  
  for (const char of text) {
    const testLine = currentLine + char;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

async function getTempUrl(src: string): Promise<string> {
  if (!src) return '';
  if (!src.startsWith('cloud://')) return src;
  
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: [src],
      success: (res) => {
        if (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) {
          resolve(res.fileList[0].tempFileURL);
        } else {
          resolve('');
        }
      },
      fail: () => {
        resolve('');
      },
    });
  });
}

function loadImage(canvas: any, src: string): Promise<any> {
  return new Promise(async (resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const actualSrc = await getTempUrl(src);
    if (!actualSrc) {
      resolve(null);
      return;
    }
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = actualSrc;
  });
}

function roundRect(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function measureTextHeight(ctx: any, text: string, maxWidth: number, lineHeight: number): number {
  const lines = wrapText(ctx, text, maxWidth);
  return lines.length * lineHeight;
}

async function calculateTotalHeight(
  canvas: any,
  ctx: any,
  character: ICharacterInfo,
  galleryImages: string[],
  contentWidth: number
): Promise<number> {
  let height = 0;
  
  // Header
  height += rpx(STYLES.header.padding);
  height += rpx(STYLES.characterName.fontSize) + rpx(STYLES.characterName.marginBottom);
  
  ctx.font = `${rpx(STYLES.characterIntro.fontSize)}px ${FONT_FAMILY}`;
  const introLines = wrapText(ctx, character.introduction, contentWidth - rpx(STYLES.header.horizontalPadding) * 2);
  height += introLines.length * rpx(STYLES.characterIntro.fontSize) * STYLES.characterIntro.lineHeight;
  height += rpx(STYLES.header.padding);
  
  // Body padding
  height += rpx(STYLES.body.padding);
  
  // 基本信息
  height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
  height += 5 * (rpx(STYLES.infoItem.fontSize) + rpx(STYLES.infoItem.marginBottom));
  height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  
  // 性格标签
  if (character.personalityTags && character.personalityTags.length > 0) {
    height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
    ctx.font = `${rpx(STYLES.personalityTag.fontSize)}px ${FONT_FAMILY}`;
    const tagHeight = rpx(STYLES.personalityTag.paddingVertical) * 2 + rpx(STYLES.personalityTag.fontSize);
    let tagX = 0;
    let tagY = 0;
    for (const tag of character.personalityTags) {
      const tagWidth = ctx.measureText(tag).width + rpx(STYLES.personalityTag.paddingHorizontal) * 2;
      if (tagX + tagWidth > contentWidth && tagX > 0) {
        tagX = 0;
        tagY += tagHeight + rpx(STYLES.personalityTag.gap);
      }
      tagX += tagWidth + rpx(STYLES.personalityTag.gap);
    }
    height += tagY + tagHeight;
    height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  }
  
  // 外观描述
  height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
  if (character.appearance.hairColor) height += rpx(STYLES.appearanceAttr.valueFontSize) + rpx(STYLES.appearanceAttr.marginBottom);
  if (character.appearance.eyeColor) height += rpx(STYLES.appearanceAttr.valueFontSize) + rpx(STYLES.appearanceAttr.marginBottom);
  if (character.appearance.customAttrs) {
    height += character.appearance.customAttrs.length * (rpx(STYLES.appearanceAttr.valueFontSize) + rpx(STYLES.appearanceAttr.marginBottom));
  }
  if (character.appearance.detail) {
    ctx.font = `${rpx(STYLES.appearanceDetail.fontSize)}px ${FONT_FAMILY}`;
    const lineHeight = rpx(STYLES.appearanceDetail.fontSize) * STYLES.appearanceDetail.lineHeight;
    const detailHeight = measureTextHeight(ctx, character.appearance.detail, contentWidth - rpx(STYLES.appearanceDetail.padding) * 2, lineHeight);
    height += rpx(STYLES.appearanceDetail.marginTop) + detailHeight + rpx(STYLES.appearanceDetail.padding) * 2;
  }
  height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  
  // 性格描述
  height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
  ctx.font = `${rpx(STYLES.longText.fontSize)}px ${FONT_FAMILY}`;
  const personalityLineHeight = rpx(STYLES.longText.fontSize) * STYLES.longText.lineHeight;
  height += measureTextHeight(ctx, character.personality, contentWidth, personalityLineHeight);
  height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  
  // 角色背景
  height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
  height += measureTextHeight(ctx, character.backstory, contentWidth, personalityLineHeight);
  height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  
  // 故事线
  if (character.storyline) {
    height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
    height += measureTextHeight(ctx, character.storyline, contentWidth, personalityLineHeight);
    height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  }
  
  // 特殊能力
  if (character.abilities && character.abilities.length > 0) {
    height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
    for (const ability of character.abilities) {
      const nameHeight = rpx(STYLES.abilityName.fontSize) + rpx(STYLES.abilityName.marginBottom);
      ctx.font = `${rpx(STYLES.abilityDesc.fontSize)}px ${FONT_FAMILY}`;
      const descLineHeight = rpx(STYLES.abilityDesc.fontSize) * STYLES.abilityDesc.lineHeight;
      const descHeight = measureTextHeight(ctx, ability.description || '', contentWidth - rpx(STYLES.abilityItem.padding) * 2, descLineHeight);
      height += rpx(STYLES.abilityItem.padding) * 2 + nameHeight + descHeight + rpx(STYLES.abilityItem.gap);
    }
    height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  }
  
  // 关系网
  if (character.relationships && character.relationships.length > 0) {
    height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
    height += character.relationships.length * (rpx(STYLES.relationshipItem.paddingVertical) * 2 + rpx(STYLES.relCharacter.fontSize) + rpx(STYLES.relationshipItem.gap));
    height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  }
  
  // 性格六维图
  if (character.radar) {
    height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
    height += rpx(STYLES.radar.size) + rpx(STYLES.radar.marginVertical) * 2;
    height += rpx(STYLES.sectionDivider.marginVertical) * 2 + rpx(STYLES.sectionDivider.height);
  }
  
  // 角色画廊
  if (galleryImages && galleryImages.length > 0) {
    height += rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
    for (const imgSrc of galleryImages) {
      const img = await loadImage(canvas, imgSrc);
      if (img) {
        const aspectRatio = img.width / img.height;
        height += contentWidth / aspectRatio + rpx(STYLES.gallery.gap);
      } else {
        height += 200 + rpx(STYLES.gallery.gap);
      }
    }
    height -= rpx(STYLES.gallery.gap);
  }
  
  height += rpx(STYLES.body.padding);
  
  return height;
}

export async function exportCharacterCard(
  canvasId: string,
  component: any,
  character: ICharacterInfo,
  galleryImages: string[]
): Promise<string> {
  const pageWidth = STYLES.page.width;
  const contentWidth = pageWidth - rpx(STYLES.page.padding) * 2 - rpx(STYLES.body.padding) * 2;

  return new Promise((resolve, reject) => {
    const query = wx.createSelectorQuery().in(component);
    query
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('Canvas not found'));
          return;
        }

        const canvas = res[0].node as WechatMiniprogram.Canvas;
        const ctx = canvas.getContext('2d');

        const totalHeight = await calculateTotalHeight(canvas, ctx, character, galleryImages, contentWidth);
        const pageHeight = totalHeight + rpx(STYLES.page.padding) * 2;
        
        // 设置 canvas 尺寸（高清输出）
        canvas.width = pageWidth * DPR;
        canvas.height = pageHeight * DPR;
        ctx.scale(DPR, DPR);

        // 绘制页面背景
        const bgGradient = ctx.createLinearGradient(0, 0, 0, pageHeight);
        bgGradient.addColorStop(0, STYLES.page.background[0]);
        bgGradient.addColorStop(1, STYLES.page.background[1]);
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, pageWidth, pageHeight);

        // 计算卡片位置和尺寸
        const cardX = rpx(STYLES.page.padding);
        const cardY = rpx(STYLES.page.padding);
        const cardWidth = pageWidth - rpx(STYLES.page.padding) * 2;
        const cardHeight = totalHeight;
        
        // 绘制卡片阴影
        ctx.save();
        ctx.shadowColor = STYLES.card.shadowColor;
        ctx.shadowBlur = rpx(STYLES.card.shadowBlur);
        ctx.shadowOffsetY = rpx(STYLES.card.shadowOffsetY);
        
        // 绘制卡片背景
        ctx.fillStyle = STYLES.card.background;
        roundRect(ctx, cardX, cardY, cardWidth, cardHeight, rpx(STYLES.card.borderRadius));
        ctx.fill();
        ctx.restore();
        
        // 绘制卡片边框
        if (STYLES.card.borderWidth > 0) {
          ctx.strokeStyle = STYLES.card.borderColor;
          ctx.lineWidth = rpx(STYLES.card.borderWidth);
          roundRect(ctx, cardX, cardY, cardWidth, cardHeight, rpx(STYLES.card.borderRadius));
          ctx.stroke();
        }

        // 计算头部高度
        ctx.font = `${rpx(STYLES.characterIntro.fontSize)}px ${FONT_FAMILY}`;
        const introLines = wrapText(ctx, character.introduction, contentWidth);
        const introHeight = introLines.length * rpx(STYLES.characterIntro.fontSize) * STYLES.characterIntro.lineHeight;
        const headerHeight = rpx(STYLES.header.padding) + rpx(STYLES.characterName.fontSize) + rpx(STYLES.characterName.marginBottom) + introHeight + rpx(STYLES.header.padding);
        
        // 绘制头部背景（对角渐变）
        const headerGradient = ctx.createLinearGradient(cardX, cardY, cardX + cardWidth, cardY + headerHeight);
        headerGradient.addColorStop(0, STYLES.header.background[0]);
        headerGradient.addColorStop(0.6, STYLES.header.background[1]);
        headerGradient.addColorStop(1, STYLES.header.background[2]);
        ctx.fillStyle = headerGradient;
        roundRect(ctx, cardX, cardY, cardWidth, headerHeight, rpx(STYLES.card.borderRadius));
        ctx.fill();

        // 绘制头部内容
        let currentY = cardY + rpx(STYLES.header.padding);
        
        // 角色名称
        ctx.font = `${STYLES.characterName.fontWeight} ${rpx(STYLES.characterName.fontSize)}px ${FONT_FAMILY}`;
        ctx.fillStyle = STYLES.characterName.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(character.name, cardX + cardWidth / 2, currentY);
        currentY += rpx(STYLES.characterName.fontSize) + rpx(STYLES.characterName.marginBottom);
        
        // 角色简介
        ctx.font = `${rpx(STYLES.characterIntro.fontSize)}px ${FONT_FAMILY}`;
        ctx.fillStyle = STYLES.characterIntro.color;
        for (const line of introLines) {
          ctx.fillText(line, cardX + cardWidth / 2, currentY);
          currentY += rpx(STYLES.characterIntro.fontSize) * STYLES.characterIntro.lineHeight;
        }

        // 绘制 body 内容
        currentY = cardY + headerHeight + rpx(STYLES.body.padding);
        const contentX = cardX + rpx(STYLES.body.padding);

        // 绘制章节标题
        function drawSectionTitle(title: string, y: number): number {
          ctx.font = `${STYLES.sectionTitle.fontWeight} ${rpx(STYLES.sectionTitle.fontSize)}px ${FONT_FAMILY}`;
          ctx.fillStyle = STYLES.sectionTitle.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(title.toUpperCase(), contentX, y);
          return y + rpx(STYLES.sectionTitle.fontSize) + rpx(STYLES.sectionTitle.marginBottom);
        }

        // 绘制分割线
        function drawDivider(y: number): number {
          const dividerGradient = ctx.createLinearGradient(contentX, y, contentX + contentWidth, y);
          dividerGradient.addColorStop(0, '#e5e7eb');
          dividerGradient.addColorStop(1, 'transparent');
          ctx.fillStyle = dividerGradient;
          ctx.fillRect(contentX, y, contentWidth, rpx(STYLES.sectionDivider.height));
          return y + rpx(STYLES.sectionDivider.height) + rpx(STYLES.sectionDivider.marginVertical);
        }

        // 绘制信息项
        function drawInfoItem(label: string, value: string, y: number): number {
          ctx.font = `${rpx(STYLES.infoItem.fontSize)}px ${FONT_FAMILY}`;
          ctx.fillStyle = STYLES.infoItem.labelColor;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(label, contentX, y);
          
          const labelWidth = ctx.measureText(label).width;
          ctx.fillStyle = STYLES.infoItem.valueColor;
          ctx.fillText(value, contentX + labelWidth, y);
          
          return y + rpx(STYLES.infoItem.fontSize) + rpx(STYLES.infoItem.marginBottom);
        }

        // 基本信息
        currentY = drawSectionTitle('基本信息', currentY);
        currentY = drawInfoItem('姓名：', character.name, currentY);
        currentY = drawInfoItem('性别：', character.gender, currentY);
        currentY = drawInfoItem('星座：', character.constellation || '未知', currentY);
        currentY = drawInfoItem('生日：', character.birthday || '未知', currentY);
        currentY = drawInfoItem('物种：', character.species, currentY);
        currentY = drawDivider(currentY);

        // 性格标签
        if (character.personalityTags && character.personalityTags.length > 0) {
          currentY = drawSectionTitle('性格标签', currentY);
          
          const tagStyle = STYLES.personalityTag;
          ctx.font = `${tagStyle.fontWeight} ${rpx(tagStyle.fontSize)}px ${FONT_FAMILY}`;
          
          let tagX = contentX;
          let tagY = currentY;
          const tagHeight = rpx(tagStyle.paddingVertical) * 2 + rpx(tagStyle.fontSize);
          
          for (const tag of character.personalityTags) {
            const tagWidth = ctx.measureText(tag).width + rpx(tagStyle.paddingHorizontal) * 2;
            
            if (tagX + tagWidth > contentX + contentWidth && tagX > contentX) {
              tagX = contentX;
              tagY += tagHeight + rpx(tagStyle.gap);
            }
            
            // 标签背景渐变
            const tagGradient = ctx.createLinearGradient(tagX, tagY, tagX + tagWidth, tagY + tagHeight);
            tagGradient.addColorStop(0, tagStyle.background[0]);
            tagGradient.addColorStop(1, tagStyle.background[1]);
            
            ctx.fillStyle = tagGradient;
            roundRect(ctx, tagX, tagY, tagWidth, tagHeight, rpx(tagStyle.borderRadius));
            ctx.fill();
            
            // 标签边框
            ctx.strokeStyle = tagStyle.borderColor;
            ctx.lineWidth = rpx(tagStyle.borderWidth);
            roundRect(ctx, tagX, tagY, tagWidth, tagHeight, rpx(tagStyle.borderRadius));
            ctx.stroke();
            
            // 标签文字
            ctx.fillStyle = tagStyle.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tag, tagX + tagWidth / 2, tagY + tagHeight / 2);
            
            tagX += tagWidth + rpx(tagStyle.gap);
          }
          
          currentY = tagY + tagHeight + rpx(STYLES.sectionDivider.marginVertical);
          currentY = drawDivider(currentY);
        }

        // 外观描述
        currentY = drawSectionTitle('外观描述', currentY);
        
        function drawAppearanceAttr(label: string, value: string, y: number, isCustom: boolean = false): number {
          const attrStyle = STYLES.appearanceAttr;
          let currentX = contentX;
          
          // 颜色圆点
          const dotGradient = ctx.createLinearGradient(currentX, y, currentX + rpx(attrStyle.dotSize), y + rpx(attrStyle.dotSize));
          if (isCustom) {
            dotGradient.addColorStop(0, '#d1d5db');
            dotGradient.addColorStop(1, '#9ca3af');
          } else {
            dotGradient.addColorStop(0, attrStyle.dotBackground[0]);
            dotGradient.addColorStop(1, attrStyle.dotBackground[1]);
          }
          
          ctx.fillStyle = dotGradient;
          roundRect(ctx, currentX, y + (rpx(attrStyle.valueFontSize) - rpx(attrStyle.dotSize)) / 2, rpx(attrStyle.dotSize), rpx(attrStyle.dotSize), rpx(attrStyle.dotBorderRadius));
          ctx.fill();
          
          currentX += rpx(attrStyle.dotSize) + rpx(attrStyle.gap);
          
          // 标签
          ctx.font = `${attrStyle.labelFontWeight} ${rpx(attrStyle.labelFontSize)}px ${FONT_FAMILY}`;
          ctx.fillStyle = attrStyle.labelColor;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(label, currentX, y);
          currentX += ctx.measureText(label).width + rpx(attrStyle.gap);
          
          // 值
          ctx.font = `${rpx(attrStyle.valueFontSize)}px ${FONT_FAMILY}`;
          ctx.fillStyle = attrStyle.valueColor;
          ctx.fillText(value, currentX, y);
          
          return y + rpx(attrStyle.valueFontSize) + rpx(attrStyle.marginBottom);
        }
        
        if (character.appearance.hairColor) {
          currentY = drawAppearanceAttr('发色', character.appearance.hairColor, currentY);
        }
        if (character.appearance.eyeColor) {
          currentY = drawAppearanceAttr('瞳色', character.appearance.eyeColor, currentY);
        }
        if (character.appearance.customAttrs) {
          for (const attr of character.appearance.customAttrs) {
            currentY = drawAppearanceAttr(attr.label, attr.value, currentY, true);
          }
        }
        if (character.appearance.detail) {
          currentY += rpx(STYLES.appearanceDetail.marginTop);
          
          const detailStyle = STYLES.appearanceDetail;
          ctx.font = `${rpx(detailStyle.fontSize)}px ${FONT_FAMILY}`;
          const lineHeight = rpx(detailStyle.fontSize) * detailStyle.lineHeight;
          const lines = wrapText(ctx, character.appearance.detail, contentWidth - rpx(detailStyle.padding) * 2);
          const detailHeight = lines.length * lineHeight + rpx(detailStyle.padding) * 2;
          const offset = rpx(4); // 深色框偏移量
          
          // 深色底层框（偏左露出左侧边缘）
          ctx.fillStyle = detailStyle.borderLeftColor;
          roundRect(ctx, contentX - offset, currentY, contentWidth, detailHeight, rpx(detailStyle.borderRadius));
          ctx.fill();
          
          // 白色内容框
          ctx.fillStyle = detailStyle.background;
          roundRect(ctx, contentX, currentY, contentWidth, detailHeight, rpx(detailStyle.borderRadius));
          ctx.fill();
          
          // 文字
          ctx.fillStyle = detailStyle.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          let textY = currentY + rpx(detailStyle.padding);
          for (const line of lines) {
            ctx.fillText(line, contentX + rpx(detailStyle.padding), textY);
            textY += lineHeight;
          }
          
          currentY += detailHeight;
        }
        currentY = drawDivider(currentY);

        // 绘制长文本段落
        function drawLongText(text: string, y: number): number {
          const textStyle = STYLES.longText;
          ctx.font = `${rpx(textStyle.fontSize)}px ${FONT_FAMILY}`;
          ctx.fillStyle = textStyle.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          
          const lineHeight = rpx(textStyle.fontSize) * textStyle.lineHeight;
          const lines = wrapText(ctx, text, contentWidth);
          
          let textY = y;
          for (const line of lines) {
            ctx.fillText(line, contentX, textY);
            textY += lineHeight;
          }
          
          return textY;
        }

        // 性格描述
        currentY = drawSectionTitle('性格描述', currentY);
        currentY = drawLongText(character.personality, currentY);
        currentY = drawDivider(currentY);

        // 角色背景
        currentY = drawSectionTitle('角色背景', currentY);
        currentY = drawLongText(character.backstory, currentY);
        currentY = drawDivider(currentY);

        // 故事线
        if (character.storyline) {
          currentY = drawSectionTitle('故事线', currentY);
          currentY = drawLongText(character.storyline, currentY);
          currentY = drawDivider(currentY);
        }

        // 特殊能力
        if (character.abilities && character.abilities.length > 0) {
          currentY = drawSectionTitle('特殊能力', currentY);
          
          for (const ability of character.abilities) {
            const itemStyle = STYLES.abilityItem;
            const nameStyle = STYLES.abilityName;
            const descStyle = STYLES.abilityDesc;

            // 计算高度
            const nameHeight = rpx(nameStyle.fontSize) + rpx(nameStyle.marginBottom);
            ctx.font = `${rpx(descStyle.fontSize)}px ${FONT_FAMILY}`;
            const descLineHeight = rpx(descStyle.fontSize) * descStyle.lineHeight;
            const descLines = wrapText(ctx, ability.description || '', contentWidth - rpx(itemStyle.padding) * 2);
            const descHeight = descLines.length * descLineHeight;
            const itemHeight = rpx(itemStyle.padding) * 2 + nameHeight + descHeight;
            const offset = rpx(4); // 深色框偏移量

            // 深色底层框（偏左露出左侧边缘）
            ctx.fillStyle = itemStyle.borderLeftColor;
            roundRect(ctx, contentX - offset, currentY, contentWidth, itemHeight, rpx(itemStyle.borderRadius));
            ctx.fill();

            // 白色内容框
            ctx.fillStyle = itemStyle.background;
            roundRect(ctx, contentX, currentY, contentWidth, itemHeight, rpx(itemStyle.borderRadius));
            ctx.fill();

            // 能力名称
            ctx.font = `${nameStyle.fontWeight} ${rpx(nameStyle.fontSize)}px ${FONT_FAMILY}`;
            ctx.fillStyle = nameStyle.color;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(ability.name, contentX + rpx(itemStyle.padding), currentY + rpx(itemStyle.padding));

            // 能力描述
            ctx.font = `${rpx(descStyle.fontSize)}px ${FONT_FAMILY}`;
            ctx.fillStyle = descStyle.color;
            let descY = currentY + rpx(itemStyle.padding) + nameHeight;
            for (const line of descLines) {
              ctx.fillText(line, contentX + rpx(itemStyle.padding), descY);
              descY += descLineHeight;
            }

            currentY += itemHeight + rpx(itemStyle.gap);
          }
          
          currentY = drawDivider(currentY);
        }

        // 关系网
        if (character.relationships && character.relationships.length > 0) {
          currentY = drawSectionTitle('关系网', currentY);
          
          for (const rel of character.relationships) {
            const itemStyle = STYLES.relationshipItem;
            const charStyle = STYLES.relCharacter;
            const arrowStyle = STYLES.relArrow;
            const descStyle = STYLES.relDesc;
            
            // 计算关系描述所需的宽度
            ctx.font = `${rpx(descStyle.fontSize)}px ${FONT_FAMILY}`;
            const arrowText = ' → ';
            const arrowWidth = ctx.measureText(arrowText).width;
            
            ctx.font = `${charStyle.fontWeight} ${rpx(charStyle.fontSize)}px ${FONT_FAMILY}`;
            const charWidth = ctx.measureText(rel.character).width;
            
            // 关系描述可用宽度
            const descAvailableWidth = contentWidth - rpx(itemStyle.paddingHorizontal) * 2 - charWidth - arrowWidth;
            
            // 换行处理关系描述
            const descLines = wrapText(ctx, rel.relation, descAvailableWidth);
            const lineHeight = rpx(descStyle.fontSize) * 1.5;
            const descHeight = descLines.length * lineHeight;
            const itemHeight = Math.max(
              rpx(itemStyle.paddingVertical) * 2 + rpx(charStyle.fontSize),
              rpx(itemStyle.paddingVertical) * 2 + descHeight
            );
            
            // 背景
            ctx.fillStyle = itemStyle.background;
            roundRect(ctx, contentX, currentY, contentWidth, itemHeight, rpx(itemStyle.borderRadius));
            ctx.fill();
            
            // 内容
            let relX = contentX + rpx(itemStyle.paddingHorizontal);
            const textY = currentY + rpx(itemStyle.paddingVertical);
            
            // 角色名
            ctx.font = `${charStyle.fontWeight} ${rpx(charStyle.fontSize)}px ${FONT_FAMILY}`;
            ctx.fillStyle = charStyle.color;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(rel.character, relX, textY);
            relX += ctx.measureText(rel.character).width;
            
            // 箭头
            ctx.font = `${rpx(arrowStyle.fontSize)}px ${FONT_FAMILY}`;
            ctx.fillStyle = arrowStyle.color;
            ctx.fillText(arrowText, relX, textY);
            relX += arrowWidth;
            
            // 关系描述（支持换行）
            ctx.font = `${rpx(descStyle.fontSize)}px ${FONT_FAMILY}`;
            ctx.fillStyle = descStyle.color;
            let descY = textY;
            for (const line of descLines) {
              ctx.fillText(line, relX, descY);
              descY += lineHeight;
            }
            
            currentY += itemHeight + rpx(itemStyle.gap);
          }
          
          currentY = drawDivider(currentY);
        }

        // 性格六维图
        if (character.radar) {
          currentY = drawSectionTitle('性格六维图', currentY);
          currentY += rpx(STYLES.radar.marginVertical);
          
          const radarSize = rpx(STYLES.radar.size);
          const radarRadius = radarSize / 2;
          const radarCenterX = cardX + cardWidth / 2;
          const radarCenterY = currentY + radarRadius;
          
          drawRadarChart(ctx, character.radar, radarCenterX, radarCenterY, radarRadius);
          
          currentY += radarSize + rpx(STYLES.radar.marginVertical) + rpx(40); // 增加额外间距
          currentY = drawDivider(currentY);
        }

        // 角色画廊
        if (galleryImages && galleryImages.length > 0) {
          currentY = drawSectionTitle('角色画廊', currentY);
          
          for (const imgSrc of galleryImages) {
            const img = await loadImage(canvas, imgSrc);
            if (img) {
              const aspectRatio = img.width / img.height;
              const imageHeight = contentWidth / aspectRatio;
              
              // 圆角裁剪
              ctx.save();
              roundRect(ctx, contentX, currentY, contentWidth, imageHeight, rpx(STYLES.gallery.borderRadius));
              ctx.clip();
              ctx.drawImage(img, contentX, currentY, contentWidth, imageHeight);
              ctx.restore();
              
              currentY += imageHeight + rpx(STYLES.gallery.gap);
            } else {
              // 占位背景
              ctx.fillStyle = STYLES.gallery.background;
              roundRect(ctx, contentX, currentY, contentWidth, 200, rpx(STYLES.gallery.borderRadius));
              ctx.fill();
              currentY += 200 + rpx(STYLES.gallery.gap);
            }
          }
        }

        // 导出图片
        wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
          destWidth: canvas.width,
          destHeight: canvas.height,
          fileType: 'png',
          quality: 1,
          success: (res) => {
            resolve(res.tempFilePath);
          },
          fail: (err) => {
            reject(err);
          },
        });
      });
  });
}

function drawRadarChart(
  ctx: any,
  radar: IPersonalityRadar,
  centerX: number,
  centerY: number,
  radius: number
): void {
  const labels = ['外向度', '理智度', '善良度', '胆识度', '开放度', '责任感'];
  const values = [
    radar.extroversion,
    radar.rationality,
    radar.kindness,
    radar.courage,
    radar.openness,
    radar.responsibility,
  ];

  const sides = 6;
  const angleStep = (Math.PI * 2) / sides;
  const startAngle = -Math.PI / 2;

  const getPoint = (i: number, r: number) => ({
    x: centerX + r * Math.cos(startAngle + i * angleStep),
    y: centerY + r * Math.sin(startAngle + i * angleStep)
  });

  // 绘制背景网格
  for (let level = 1; level <= 5; level++) {
    const levelRadius = (radius * level) / 5;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const p = getPoint(i, levelRadius);
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
    const p = getPoint(i, radius);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // 绘制数据区域（灰色渐变，非蓝色）
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const r = radius * (values[i] / 100);
    const p = getPoint(i, r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  // 灰色渐变填充
  const gradient = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
  gradient.addColorStop(0, 'rgba(156, 163, 175, 0.3)');
  gradient.addColorStop(1, 'rgba(75, 85, 99, 0.15)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // 灰色渐变描边
  const strokeGrad = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
  strokeGrad.addColorStop(0, '#9ca3af');
  strokeGrad.addColorStop(1, '#4b5563');
  ctx.strokeStyle = strokeGrad;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 绘制数据点（圆点）
  for (let i = 0; i < sides; i++) {
    const r = radius * (values[i] / 100);
    const p = getPoint(i, r);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rpx(6), 0, Math.PI * 2);
    ctx.fillStyle = '#4b5563';
    ctx.fill();
  }

  // 绘制标签
  ctx.font = `500 ${rpx(20)}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < sides; i++) {
    const labelRadius = radius + rpx(35);
    const p = getPoint(i, labelRadius);
    ctx.fillText(labels[i], p.x, p.y);
  }
}

export async function saveImageToAlbum(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
        resolve(true);
      },
      fail: (err) => {
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            confirmText: '去授权',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting();
              }
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
        resolve(false);
      },
    });
  });
}
