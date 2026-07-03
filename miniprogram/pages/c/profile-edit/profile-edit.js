const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, PAGES } = require('../../../utils/constants')
const { redirectAfterLogin, setAccountInfo } = require('../../../utils/auth')

const PROFILE_CATEGORY_OPTIONS = [
  { name: '建筑工', icon: '建筑' },
  { name: '保洁', icon: '保洁' },
  { name: '搬运工', icon: '搬运' },
  { name: '家政', icon: '家政' },
  { name: '保安', icon: '保安' },
  { name: '绿化', icon: '绿化' },
  { name: '配送', icon: '配送' },
  { name: '维修', icon: '维修' }
]

Page({
  data: {
    mode: 'edit',
    redirect: '',
    redirectTab: false,
    currentStep: 1,
    totalSteps: 4,
    stepTitle: '',
    stepDesc: '',
    categoryOptions: PROFILE_CATEGORY_OPTIONS,
    genderOptions: ['男', '女'],
    relationOptions: ['本人', '子女代登记', '村干部代登记', '工作人员代登记'],
    areaOptions: ['山阳县城附近', '山阳各乡镇', '商洛市内', '西安周边'],
    profile: {
      name: '',
      gender: '',
      birthYear: '',
      phone: '',
      relation: '本人',
      expectJob: '',
      expectArea: '',
      skills: [],
      idNumber: '',
      idCardAddress: '',
      idCardFront: '',
      idCardBack: '',
      isPoor: false,
      poorDescription: ''
    },
    saving: false
  },

  onLoad(options = {}) {
    this.setData({
      mode: options.mode || 'edit',
      redirect: decodeURIComponent(options.redirect || ''),
      redirectTab: options.redirectTab === '1'
    })
    this.syncStepMeta()
    this.loadProfile(options)
  },

  syncStepMeta() {
    const metaMap = {
      1: {
        title: '第一步：登记基本信息',
        desc: '先把最基础的信息填好，方便平台联系您'
      },
      2: {
        title: '第二步：登记找工意向',
        desc: '告诉平台您想找什么工作，推荐会更准确'
      },
      3: {
        title: '第三步：登记个人情况',
        desc: '如需政策帮扶，也请一并告诉我们'
      },
      4: {
        title: '第四步：上传证件照片',
        desc: '证件信息越完整，企业越容易放心录用'
      }
    }

    const current = metaMap[this.data.currentStep]
    this.setData({
      stepTitle: current.title,
      stepDesc: current.desc
    })
  },

  async loadProfile(options = {}) {
    wx.showLoading({ title: '加载中...' })
    try {
      const res = await call(CLOUD_FUNCTIONS.JOBSEEKER, 'getProfile')
      const incomingPhone = options.phone || ''

      if (res) {
        this.setData({
          profile: {
            name: res.name || '',
            gender: res.gender || '',
            birthYear: res.birthYear || '',
            phone: res.phone || incomingPhone,
            relation: res.relation || '本人',
            expectJob: res.expectJob || '',
            expectArea: res.expectArea || '',
            skills: Array.isArray(res.skills) ? res.skills : [],
            idNumber: res.idNumber || '',
            idCardAddress: res.idCardAddress || '',
            idCardFront: res.idCardFront || '',
            idCardBack: res.idCardBack || '',
            isPoor: !!res.isPoor,
            poorDescription: res.poorDescription || ''
          }
        })
      } else if (incomingPhone) {
        this.setData({
          'profile.phone': incomingPhone
        })
      }
    } catch (err) {
      console.error('[profile-edit] load error', err)
    } finally {
      wx.hideLoading()
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({
      ['profile.' + field]: e.detail.value
    })
  },

  onChooseOption(e) {
    const { field, value } = e.currentTarget.dataset
    this.setData({
      ['profile.' + field]: value
    })
  },

  onToggleSkill(e) {
    const skill = e.currentTarget.dataset.skill
    const currentSkills = Array.isArray(this.data.profile.skills) ? this.data.profile.skills : []
    const skills = currentSkills.slice()
    const index = skills.indexOf(skill)

    if (index >= 0) {
      skills.splice(index, 1)
    } else if (skills.length < 4) {
      skills.push(skill)
    }

    this.setData({
      'profile.skills': skills
    })
  },

  onPoorChange(e) {
    this.setData({
      'profile.isPoor': !!e.detail.value
    })
  },

  async handleUpload(e) {
    const side = e.currentTarget.dataset.side

    try {
      const res = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      })

      if (!res.tempFilePaths || res.tempFilePaths.length === 0) {
        return
      }

      const path = res.tempFilePaths[0]
      const ext = (path.match(/\.(\w+)$/) || ['', 'jpg'])[1]
      const cloudPath = `idcard/${Date.now()}_${side}.${ext}`

      wx.showLoading({ title: '上传中...' })
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: path
      })
      wx.hideLoading()

      if (uploadRes.fileID) {
        const key = 'profile.idCard' + (side === 'front' ? 'Front' : 'Back')
        this.setData({ [key]: uploadRes.fileID })
        wx.showToast({
          title: '上传成功',
          icon: 'none'
        })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('[profile-edit] upload error', err)
      wx.showToast({
        title: '上传失败',
        icon: 'none'
      })
    }
  },

  handlePreview(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({
      urls: [this.data.profile.idCardFront, this.data.profile.idCardBack].filter(Boolean),
      current: url
    })
  },

  validateCurrentStep() {
    const { currentStep, profile } = this.data

    if (currentStep === 1) {
      if (!profile.name.trim()) return '请填写姓名'
      if (!profile.gender) return '请选择性别'
      if (!profile.birthYear.trim()) return '请填写出生年份'
      if (!/^1\d{10}$/.test(profile.phone)) return '请填写正确手机号'
      return ''
    }

    if (currentStep === 2) {
      if (!profile.expectJob.trim()) return '请填写想找的工种'
      if (!profile.expectArea.trim()) return '请选择期望区域'
      if (!profile.skills.length) return '请至少选择一项技能'
      return ''
    }

    if (currentStep === 3) {
      if (!profile.idNumber.trim()) return '请填写身份证号'
      if (!profile.idCardAddress.trim()) return '请填写身份证地址'
      if (profile.isPoor && !profile.poorDescription.trim()) return '请填写帮扶说明'
      return ''
    }

    if (currentStep === 4) {
      if (!profile.idCardFront) return '请上传身份证正面'
      if (!profile.idCardBack) return '请上传身份证反面'
    }

    return ''
  },

  handlePrevStep() {
    if (this.data.currentStep <= 1) {
      if (this.data.mode === 'onboarding') {
        wx.showModal({
          title: '暂未完成资料登记',
          content: '返回后仍需要继续完善资料，是否先回到登录页？',
          success: (res) => {
            if (!res.confirm) {
              return
            }

            const params = []

            if (this.data.redirect) {
              params.push(`redirect=${encodeURIComponent(this.data.redirect)}`)
            }

            if (this.data.redirectTab) {
              params.push('redirectTab=1')
            }

            wx.redirectTo({
              url: `/pages/c/login/login?mode=register${params.length ? `&${params.join('&')}` : ''}`
            })
          }
        })
        return
      }

      wx.navigateBack()
      return
    }

    this.setData({
      currentStep: this.data.currentStep - 1
    })
    this.syncStepMeta()
  },

  handleNextStep() {
    const error = this.validateCurrentStep()
    if (error) {
      wx.showToast({
        title: error,
        icon: 'none'
      })
      return
    }

    if (this.data.currentStep >= this.data.totalSteps) {
      this.handleSave()
      return
    }

    this.setData({
      currentStep: this.data.currentStep + 1
    })
    this.syncStepMeta()
  },

  async handleSave() {
    if (this.data.saving) return

    const error = this.validateCurrentStep()
    if (error) {
      wx.showToast({
        title: error,
        icon: 'none'
      })
      return
    }

    this.setData({ saving: true })

    try {
      await call(CLOUD_FUNCTIONS.JOBSEEKER, 'updateProfile', {
        ...this.data.profile,
        profileCompleted: true
      })

      let sessionAccount = null

      try {
        const accountProfile = await call(CLOUD_FUNCTIONS.ACCOUNT, 'getProfile')
        if (accountProfile && accountProfile._id) {
          sessionAccount = setAccountInfo({
            ...accountProfile,
            phone: this.data.profile.phone,
            profileCompleted: true
          })
        }
      } catch (refreshErr) {
        console.warn('[profile-edit] refresh account failed', refreshErr)
      }

      if (!sessionAccount) {
        setAccountInfo({
          ...(getApp().globalData.accountInfo || {}),
          phone: this.data.profile.phone,
          profileCompleted: true
        })
      }

      wx.showToast({
        title: '资料登记完成',
        icon: 'none'
      })

      setTimeout(() => {
        if (!redirectAfterLogin(this.data.redirect, this.data.redirectTab)) {
          wx.switchTab({ url: PAGES.C_HOME })
        }
      }, 600)
    } catch (err) {
      console.error('[profile-edit] save error', err)
      wx.showToast({
        title: err.msg || '保存失败',
        icon: 'none'
      })
    } finally {
      this.setData({ saving: false })
    }
  }
})
