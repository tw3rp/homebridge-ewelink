'use strict'
let Characteristic, Service
module.exports = class deviceFan {
  constructor (platform) {
    this.platform = platform
    Service = platform.api.hap.Service
    Characteristic = platform.api.hap.Characteristic
  }

  async internalFanUpdate (accessory, type, value, callback) {
    callback()
    try {
      let newPower
      let newSpeed
      let newLight
      const lightService = accessory.getService(Service.Lightbulb)
      const fanService = accessory.getService(Service.Fanv2)
      switch (type) {
        case 'power':
          newPower = value
          newSpeed = value ? 33 : 0
          newLight = lightService.getCharacteristic(Characteristic.On).value
          break
        case 'speed':
          newPower = value >= 33 ? 1 : 0
          newSpeed = value
          newLight = lightService.getCharacteristic(Characteristic.On).value
          break
        case 'light':
          newPower = fanService.getCharacteristic(Characteristic.Active).value
          newSpeed = fanService.getCharacteristic(Characteristic.RotationSpeed).value
          newLight = value
          break
      }
      const params = {
        switches: this.platform.devicesInEW.get(accessory.context.eweDeviceId).params.switches
      }
      params.switches[0].switch = newLight ? 'on' : 'off'
      params.switches[1].switch = newPower === 1 && newSpeed >= 33 ? 'on' : 'off'
      params.switches[2].switch = newPower === 1 && newSpeed >= 66 && newSpeed < 99 ? 'on' : 'off'
      params.switches[3].switch = newPower === 1 && newSpeed >= 99 ? 'on' : 'off'
      await this.platform.sendDeviceUpdate(accessory, params)
      lightService.updateCharacteristic(Characteristic.On, newLight)
      fanService
        .updateCharacteristic(Characteristic.Active, newPower)
        .updateCharacteristic(Characteristic.RotationSpeed, newSpeed)
    } catch (err) {
      this.platform.requestDeviceRefresh(accessory, err)
    }
  }

  externalFanUpdate (accessory, params) {
    try {
      let light
      let status
      let speed
      const lightService = accessory.getService(Service.Lightbulb)
      const fanService = accessory.getService(Service.Fanv2)
      if (Array.isArray(params.switches)) {
        light = params.switches[0].switch === 'on'
        switch (params.switches[1].switch + params.switches[2].switch + params.switches[3].switch) {
          default:
            status = 0
            speed = 0
            break
          case 'onoffoff':
            status = 1
            speed = 33
            break
          case 'ononoff':
            status = 1
            speed = 66
            break
          case 'onoffon':
            status = 1
            speed = 99
        }
      } else if (Object.prototype.hasOwnProperty.call(params, 'light') && Object.prototype.hasOwnProperty.call(params, 'fan') && Object.prototype.hasOwnProperty.call(params, 'speed')) {
        light = params.light === 'on'
        status = params.fan === 'on' ? 1 : 0
        speed = params.speed * 33 * status
      } else {
        throw new Error('unknown parameters received')
      }
      lightService.updateCharacteristic(Characteristic.On, light)
      fanService
        .updateCharacteristic(Characteristic.Active, status)
        .updateCharacteristic(Characteristic.RotationSpeed, speed)
    } catch (err) {
      this.platform.log.warn('[%s] could not be updated as %s.', accessory.displayName, err)
    }
  }
}