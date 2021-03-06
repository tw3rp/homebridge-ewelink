/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceThermostat {
  constructor (platform, accessory) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages
    this.platform = platform

    // Set up variables from the accessory
    this.name = accessory.displayName
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceId = this.accessory.context.eweDeviceId
    const deviceConf = platform.thDevices[deviceId]
    const deviceConf2 = platform.simulations[deviceId]
    this.tempOffset = deviceConf && deviceConf.offset
      ? deviceConf.offset
      : platform.consts.defaultValues.offset
    this.disableDeviceLogging = (deviceConf && deviceConf.overrideDisabledLogging) ||
      deviceConf2.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // If the accessory has a temperature sensor service then remove it
    if (this.accessory.getService(this.hapServ.TemperatureSensor)) {
      this.accessory.removeService(
        this.accessory.getService(this.hapServ.TemperatureSensor)
      )
    }

    // If the accessory has a humidity sensor service then remove it
    if (this.accessory.getService(this.hapServ.HumiditySensor)) {
      this.accessory.removeService(
        this.accessory.getService(this.hapServ.HumiditySensor)
      )
    }

    // Set up the accessory with default target temp when added the first time
    if (!this.funcs.hasProperty(this.accessory.context, 'cacheTarget')) {
      this.accessory.context.cacheTarget = 20
    }

    // Add the thermostat service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Thermostat) ||
      this.accessory.addService(this.hapServ.Thermostat)

    // Set custom properties of the current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
      minValue: -100,
      minStep: 0.1
    })

    // Add the set handler to the target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .on('set', this.internalOnOffUpdate.bind(this))
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1]
      })

    // Add the set handler to the target temperature characteristic
    this.service.getCharacteristic(this.hapChar.TargetTemperature)
      .on('set', this.internalTargetTempUpdate.bind(this))
      .setProps({
        minValue: 0,
        maxValue: 30,
        minStep: 0.5
      })

    // The DS18B20 sensor does not provide humidity readings
    if (
      this.accessory.context.sensorType !== 'DS18B20' &&
      !this.service.testCharacteristic(this.hapChar.CurrentRelativeHumidity)
    ) {
      this.service.addCharacteristic(this.hapChar.CurrentRelativeHumidity)
    }

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new this.platform.eveService('custom', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Setting this now makes the plugin send the payload to setup as thermostat
    setTimeout(() => {
      this.service.setCharacteristic(
        this.hapChar.TargetTemperature,
        this.accessory.context.cacheTarget
      )
    }, 5000)

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        disableDeviceLogging: this.disableDeviceLogging,
        offset: this.tempOffset,
        type: deviceConf2.type
      })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }
  }

  async internalOnOffUpdate (value, callback) {
    try {
      callback()
      const params = {}
      if (value === 0) {
        params.mainSwitch = 'off'
        params.switch = 'off'
      } else {
        params.mainSwitch = 'on'
      }
      this.cacheOnOff = value !== 0 ? 'on' : 'off'
      const currentTemp = this.service
        .getCharacteristic(this.hapChar.CurrentTemperature).value
      this.cacheHeat = this.cacheOnOff === 'on' &&
        currentTemp < this.accessory.context.cacheTarget
        ? 'on'
        : 'off'
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeatingCoolingState,
        this.cacheHeat === 'on' ? 1 : 0
      )
      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (!this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.name, this.cacheOnOff)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
    }
  }

  async internalTargetTempUpdate (value, callback) {
    try {
      callback()
      this.accessory.context.cacheTarget = value
      this.cacheOnOff = 'on'
      const cTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      this.cacheHeat = cTemp < value ? 'on' : 'off'
      const params = {
        deviceType: 'temperature',
        targets: [
          {
            targetHigh: value.toFixed(1),
            reaction: {
              switch: 'off'
            }
          },
          {
            targetLow: value.toFixed(1),
            reaction: {
              switch: 'on'
            }
          }
        ]
      }
      this.service.updateCharacteristic(
        this.hapChar.CurrentHeatingCoolingState,
        this.cacheHeat === 'on' ? 1 : 0
      )
      await this.platform.sendDeviceUpdate(this.accessory, params)
      if (!this.disableDeviceLogging) {
        this.log('[%s] current target [%s°C].', this.name, value)
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, true)
    }
  }

  async externalUpdate (params) {
    try {
      if (params.mainSwitch) {
        const newState = params.mainSwitch
        if (this.cacheOnOff !== newState) {
          this.cacheOnOff = newState
          this.service.updateCharacteristic(
            this.hapChar.TargetHeatingCoolingState,
            this.cacheOnOff === 'on' ? 1 : 0
          )
          this.accessory.eveService.addEntry({ status: this.cacheOnOff === 'on' ? 1 : 0 })
          if (this.cacheOnOff === 'off') {
            this.cacheHeat = 'off'
          }
          if (params.updateSource && !this.disableDeviceLogging && !params.switch) {
            this.log('[%s] current state [%s].', this.name, this.cacheOnOff)
          }
        }
      }
      if (params.switch && params.switch !== this.cacheHeat) {
        this.cacheHeat = params.switch
        this.service.updateCharacteristic(
          this.hapChar.CurrentHeatingCoolingState,
          params.switch === 'on' ? 1 : 0
        )
        if (params.updateSource && !this.disableDeviceLogging) {
          this.log('[%s] current heating [%s].', this.name, this.cacheHeat)
        }
      }
      if (
        this.funcs.hasProperty(params, 'currentTemperature') &&
        params.currentTemperature !== 'unavailable'
      ) {
        const currentTemp = Number(params.currentTemperature) + this.tempOffset
        if (this.cacheTemp !== currentTemp) {
          this.cacheTemp = currentTemp
          this.service
            .updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
          this.accessory.eveService.addEntry({ temp: currentTemp })
          if (params.updateSource && !this.disableDeviceLogging) {
            this.log('[%s] current temperature [%s°C].', this.name, this.cacheTemp)
          }
        }
      }
      if (
        this.funcs.hasProperty(params, 'currentHumidity') &&
        params.currentHumidity !== 'unavailable' &&
        this.service.testCharacteristic(this.hapChar.CurrentRelativeHumidity)
      ) {
        const currentHumi = parseInt(params.currentHumidity)
        if (this.cacheHumi !== currentHumi) {
          this.cacheHumi = currentHumi
          this.service
            .updateCharacteristic(this.hapChar.CurrentRelativeHumidity, this.cacheHumi)
          this.accessory.eveService.addEntry({ humidity: currentHumi })
          if (params.updateSource && !this.disableDeviceLogging) {
            this.log('[%s] current humidity [%s%].', this.name, this.cacheHumi)
          }
        }
      }
    } catch (err) {
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }
}
