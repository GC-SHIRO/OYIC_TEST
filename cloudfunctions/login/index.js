// 云函数入口文件
const cloud = require('wx-server-sdk')
const billingConfig = require('./billingConfig')

cloud.init({
  env: 'cloud1-0g88vkjh890eca50'
})

const db = cloud.database()

// 云函数入口函数 - 登录并注册用户
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID
  const unionId = wxContext.UNIONID || ''

  try {
    // 查询用户是否已存在
    const userRes = await db.collection('users').where({
      _openid: openId
    }).get()

    if (userRes.data.length > 0) {
      // 用户已存在，更新最后登录时间
      const user = userRes.data[0]
      await db.collection('users').doc(user._id).update({
        data: {
          lastLoginAt: db.serverDate(),
          loginCount: (user.loginCount || 0) + 1
        }
      })

      return {
        code: 0,
        message: '登录成功',
        data: {
          openId: openId,
          isNewUser: false,
          nickname: user.nickname || '',
          avatar: user.avatar || '',
          balance: user.balance || 0,
          signature: user.signature || '',
          createdAt: user.createdAt
        }
      }
    } else {
      // 新用户，创建用户记录
      const nickname = event.nickname || ''
      const avatar = event.avatar || ''

      const registerBonus = billingConfig.REGISTER_BONUS || 0

      const newUser = {
        _openid: openId,
        unionId: unionId,
        nickname: nickname,
        avatar: avatar,
        signature: '',
        balance: registerBonus,
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate(),
        lastShareAt: null,
        loginCount: 1,
        status: 'active'
      }

      const addRes = await db.collection('users').add({
        data: newUser
      })

      await db.collection('usage_logs').add({
        data: {
          _openid: openId,
          type: 'register',
          delta: registerBonus,
          balanceBefore: 0,
          balanceAfter: registerBonus,
          tokens: 0,
          conversationId: '',
          cardId: '',
          source: 'system',
          meta: {},
          createdAt: db.serverDate(),
        }
      })

      return {
        code: 0,
        message: '注册成功',
        data: {
          openId: openId,
          isNewUser: true,
          nickname: nickname,
          avatar: avatar,
          balance: registerBonus,
          signature: '',
          createdAt: new Date()
        }
      }
    }
  } catch (err) {
    console.error('登录/注册失败', err)
    return {
      code: -1,
      message: '登录失败',
      error: err.message || String(err)
    }
  }
}
