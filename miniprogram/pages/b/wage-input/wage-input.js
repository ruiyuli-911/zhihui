const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')
const { requireCompanyAccess } = require('../../../utils/auth')

Page(createPage({
  data: {
    cloudReady: true,
    submitting: false,

    // 表单数据
    employeeId: '',
    employeeName: '',
    employeePhone: '',
    jobTitle: '',
    jobId: '',
    amount: '',
    period: '',
    workDays: '',
    workHours: '',
    remark: '',

    // 员工选择器
    employees: [],
    employeeIndex: -1,
    employeePickerRange: [],

    // 周期选择器
    periodOptions: [
      '2026年6月',
      '2026年5月',
      '2026年4月',
      '2026年3月',
      '2026年2月',
      '2026年1月'
    ],
    periodIndex: -1
  },

  onLoad() {
    if (!requireCompanyAccess({
      message: '请先登录企业账号'
    })) {
      return
    }

    this.checkCloudFunction()
  },

  async checkCloudFunction() {
    try {
      const result = await call(CLOUD_FUNCTIONS.WAGE, 'ping', {})
      if (result && result.ready === false) {
        this.setData({ cloudReady: false })
        return
      }
      this.setData({ cloudReady: true })
      this.loadEmployees()
    } catch (err) {
      console.error('[wage-input] check cloud error', err)
      this.setData({ cloudReady: false })
    }
  },

  async loadEmployees() {
    try {
      const result = await call(CLOUD_FUNCTIONS.APPLY, 'listAcceptedByCompany', {
        page: 1,
        pageSize: 100
      })
      const employees = (result && result.list) || []
      this.setData({
        employees,
        employeePickerRange: employees.map((e) => `${e.jobseekerName || '未知'} - ${e.jobseekerPhone || ''}`)
      })
    } catch (err) {
      console.error('[wage-input] load employees error', err)
      // 员工列表加载失败不阻塞，允许手动输入
    }
  },

  handleEmployeeChange(event) {
    const index = event.detail.value
    const employee = this.data.employees[index] || {}
    this.setData({
      employeeIndex: index,
      employeeId: employee.jobseekerId || employee._id || '',
      employeeName: employee.jobseekerName || '',
      employeePhone: employee.jobseekerPhone || '',
      jobTitle: employee.jobTitle || '',
      jobId: employee.jobId || ''
    })
  },

  handlePeriodChange(event) {
    const index = event.detail.value
    this.setData({
      periodIndex: index,
      period: this.data.periodOptions[index] || ''
    })
  },

  handleAmountInput(event) {
    this.setData({ amount: event.detail.value })
  },

  handleWorkDaysInput(event) {
    this.setData({ workDays: event.detail.value })
  },

  handleWorkHoursInput(event) {
    this.setData({ workHours: event.detail.value })
  },

  handleRemarkInput(event) {
    this.setData({ remark: event.detail.value })
  },

  handleJobTitleInput(event) {
    this.setData({ jobTitle: event.detail.value })
  },

  async handleSubmit() {
    const { employeeId, employeeName, amount, period } = this.data

    // 校验
    if (!employeeId && !employeeName) {
      wx.showToast({ title: '请选择员工', icon: 'none' })
      return
    }

    if (!amount || Number(amount) <= 0) {
      wx.showToast({ title: '请输入有效工资金额', icon: 'none' })
      return
    }

    if (!period) {
      wx.showToast({ title: '请选择工资周期', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    try {
      await call(CLOUD_FUNCTIONS.WAGE, 'create', {
        employeeId: this.data.employeeId,
        employeeName: this.data.employeeName,
        employeePhone: this.data.employeePhone,
        jobTitle: this.data.jobTitle,
        jobId: this.data.jobId,
        amount: Number(this.data.amount),
        period: this.data.period,
        workDays: this.data.workDays ? Number(this.data.workDays) : undefined,
        workHours: this.data.workHours ? Number(this.data.workHours) : undefined,
        remark: this.data.remark || ''
      })

      wx.showToast({ title: '工资录入成功', icon: 'success' })

      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    } catch (err) {
      console.error('[wage-input] submit error', err)
      wx.showToast({
        title: (err && err.msg) || '提交失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
}))
