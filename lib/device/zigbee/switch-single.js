/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceZBSwitchSingle {
  constructor (platform, accessory) {
    this.platform = platform
    this.log = platform.log
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.helpers = platform.helpers
    this.S = platform.api.hap.Service
    this.C = platform.api.hap.Characteristic
    this.dName = accessory.displayName
    this.accessory = accessory

    this.service = this.accessory.getService(this.S.Switch) || this.accessory.addService(this.S.Switch)
    this.accessory.log = platform.config.debugFakegato ? this.log : () => {}
    this.accessory.historyService = new this.platform.eveService('switch', this.accessory, {
      storage: 'fs',
      path: platform.eveLogPath
    })
    this.service.getCharacteristic(this.C.On)
      .on('set', this.internalUpdate.bind(this))
  }

  async internalUpdate (value, callback) {
    try {
      callback()
      await this.platform.sendDeviceUpdate(this.accessory, {
        switch: value ? 'on' : 'off'
      })
      this.cacheOnOff = value ? 'on' : 'off'
      this.accessory.historyService.addEntry({
        time: Math.round(new Date().valueOf() / 1000),
        status: value ? 1 : 0
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.dName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
    }
  }

  async externalUpdate (params) {
    try {
      if (!params.switch || params.switch === this.cacheOnOff) {
        return
      }
      this.cacheOnOff = params.switch
      this.service.updateCharacteristic(this.C.On, this.cacheOnOff === 'on')
      this.accessory.historyService.addEntry({
        time: Math.round(new Date().valueOf() / 1000),
        status: this.cacheOnOff === 'on' ? 1 : 0
      })
      if (params.updateSource && !this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.dName, this.cacheOnOff)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }
}