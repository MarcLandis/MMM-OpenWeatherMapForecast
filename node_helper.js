/** *******************************

  Node Helper for MMM-OpenWeatherMapForecast.

  This helper is responsible for the data pull from OpenWeather.
  At a minimum the API key, Latitude and Longitude parameters
  must be provided.  If any of these are missing, the request
  to OpenWeather will not be executed, and instead an error
  will be output the the MagicMirror log.

  Additional, this module supplies two optional parameters:

    units - one of "metric", "imperial", or "" (blank)
    lang - Any of the languages OpenWeather supports, as listed here: https://openweathermap.org/api/one-call-api#multi

  The API request looks like this:

    https://api.openweathermap.org/data/3.0/onecall?lat=LATITUDE&lon=LONGITUDE&units=XXX&lang=YY&appid=API_KEY

*********************************/


const Log = require("logger");
const NodeHelper = require("node_helper");
const moment = require("moment");

module.exports = NodeHelper.create({

    start() {
        this.logInfo("Starting node_helper");
        this.cache = {};
        this.invalidateOldCacheIntervalId = setInterval(this.invalidateOldCache.bind(this), 12 * 60 * 60 * 1000); // Every 12 hours
    },

    stop() {
        this.logInfo("Shutting down node_helper");
        clearInterval(this.invalidateOldCacheIntervalId)
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "OPENWEATHER_ONE_CALL_FORECAST_GET") {
            this.handleOpenWeatherRequest(payload);
        }
    },

    handleOpenWeatherRequest(payload) {
        if (!this.isPayloadValid(payload)) {
            return;
        }

        const cachedResponseBody = this.getCachedResponse(payload);
        if (cachedResponseBody !== undefined) {
            this.logInfo('retrieved data from cache for');
            this.sendWeatherData(payload, cachedResponseBody);
        } else {
            this.logInfo('retrieved data from OpenWeatherMap API');
            const self = this;
            this.fetchWeatherData(payload, function (body) {
                self.sendWeatherData(payload, body);
                self.cacheResponse(payload, body);
            });
        }
    },

    isPayloadValid(payload) {
        if (!payload.apikey) {
            this.logError("No API key configured. Get an API key at https://openweathermap.org/api/one-call-api");
            return false;
        }
        if (!payload.latitude || !payload.longitude) {
            this.logError("Latitude and/or longitude not provided.");
            return false;
        }
        return true;
    },

    async fetchWeatherData(payload, successCallback) {
        const response = await fetch(this.buildApiUrl(payload));
        if (response.ok) {
            successCallback(await response.json());
        } else {
            this.logError('Error fetching data:', response);
        }
    },

    buildApiUrl(payload) {
        const params = new URLSearchParams({
            lat: payload.latitude,
            lon: payload.longitude,
            ...(payload.units ? { units: payload.units } : {}),
            ...(payload.language ? { lang: payload.language } : {}),
            appid: payload.apikey
        });

        return `${payload.endpoint}?${params}`;
    },

    getCachedResponse(payload) {
        const key = this.buildCacheKey(payload);
        const cachedEntry = this.cache[key];

        if (cachedEntry !== undefined) {
            const ageInMilliseconds = moment().diff(cachedEntry.dateTime, 'ms');
            if (ageInMilliseconds < this.getCacheTtl(payload.updateInterval)) {
                return cachedEntry.body;
            } else {
                delete this.cache[key];
            }
        }

        return undefined;
    },

    cacheResponse(payload, body) {
        const key = this.buildCacheKey(payload);
        this.cache[key] = {
            dateTime: moment(),
            cacheTtl: this.getCacheTtl(payload.updateInterval),
            body
        };
    },

    invalidateOldCache() {
        const now = moment();
        Object.keys(this.cache).forEach(key => {
            if (now.diff(this.cache[key].dateTime, 'ms') > this.cache[key].cacheTtl) {
                delete this.cache[key];
            }
        });
    },

    getCacheTtl(updateInterval) {
        return updateInterval * 60 * 1000 * 0.99;
    },

    buildCacheKey(payload) {
        return JSON.stringify({
            lat: payload.latitude,
            lon: payload.longitude,
            ...(payload.units ? { units: payload.units } : {}),
            lang: payload.language,
        });
    },

    sendWeatherData(payload, responseBody) {
        this.sendSocketNotification("OPENWEATHER_ONE_CALL_FORECAST_DATA", {
            ...responseBody,
            instanceId: payload.instanceId
        });
    },

    logInfo(...message) {
        Log.log(`[${this.name}]`, ...message);
    },

    logError(...message) {
        Log.error(`[${this.name}]`, ...message);
    }
});
