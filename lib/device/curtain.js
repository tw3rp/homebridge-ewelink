/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceCurtain {
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

    /*
      This device's parameters are:
      switch: str{'on'=OPEN, 'off'=CLOSED}
      setclose: int[0=OPEN, 100=CLOSED]
    */

    // Set up custom variables for this device type
    const deviceId = this.accessory.context.eweDeviceId
    const deviceConf = platform.singleDevices[deviceId]
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Add the window covering service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.WindowCovering) ||
      this.accessory.addService(this.hapServ.WindowCovering)

    // Add the set handler to the target position characteristic
    this.service.getCharacteristic(this.hapChar.TargetPosition)
      .on('set', this.internalUpdate.bind(this))

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({ disableDeviceLogging: this.disableDeviceLogging })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }
  }

  async internalUpdate (value, callback) {
    try {
      // Call callback() first to avoid any 'No Response' errors in HomeKit
      callback()

      // Create the params object to send
      const params = {}

      // Update the cache with the new position
      this.cachePosition = value

      // If we are to fully open/close the curtain we can use the switch param
      if ([0, 100].includes(this.cachePosition)) {
        // 'on' for fully open and 'off' for fully close
        params.switch = this.cachePosition === 100 ? 'on' : 'off'
      } else {
        // Otherwise for a %-point we can use the setclose param
        params.setclose = Math.abs(100 - this.cachePosition)
      }

      // Send the device update
      await this.platform.sendDeviceUpdate(this.accessory, params)

      // Log the update if appropriate
      if (!this.disableDeviceLogging) {
        this.log('[%s] current position [%s].', this.name, this.cachePosition)
      }
    } catch (err) {
      // Catch any errors and let the platform display them
      this.platform.deviceUpdateError(this.accessory, err, true)
    }
  }

  async externalUpdate (params) {
    try {
      // Don't continue if there are no useful parameters
      if (!params.switch && !this.funcs.hasProperty(params, 'setclose')) {
        return
      }

      // setclose is 0=OPEN 100=CLOSED whereas HomeKit is 0=CLOSED 100=OPEN
      const newPos = Math.abs(100 - parseInt(params.setclose))

      // Update HomeKit with the provided value
      this.service.updateCharacteristic(this.hapChar.TargetPosition, newPos)
      this.service.updateCharacteristic(this.hapChar.CurrentPosition, newPos)
      this.service.updateCharacteristic(this.hapChar.PositionState, 2)

      // Only update the cache and log if the provided value has changed
      if (params.updateSource && this.cachePosition !== newPos) {
        this.cachePosition = newPos
        if (!this.disableDeviceLogging) {
          this.log('[%s] current position [%s%].', this.name, this.cachePosition)
        }
      }
    } catch (err) {
      // Catch any errors and let the platform display them
      this.platform.deviceUpdateError(this.accessory, err, false)
    }
  }
}
