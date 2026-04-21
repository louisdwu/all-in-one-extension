/**
 * AQI to Concentration Converter (HJ 633-2012 Standard)
 * Converts Individual AQI (IAQI) back to mass concentration (μg/m³ or mg/m³).
 * Reference: HJ 633—2012 环境空气质量指数（AQI）技术规定（试行）
 */

const AQI_CONVERTER = {
    // Breakpoints for IAQI (same for all pollutants)
    iaqi_breaks: [0, 50, 100, 150, 200, 300, 400, 500],

    // Concentration Breakpoints (High/Low pairs for each IAQI interval)
    // Units: O3, NO2, SO2, PM2.5, PM10 in μg/m³; CO in mg/m³
    breakpoints: {
        o3:   [0, 160, 200,  300,  400,  800,  1000, 1200], // 1h mean
        no2:  [0, 100, 200,  700,  1200, 2340, 3090, 3840], // 1h mean
        so2:  [0, 150, 500,  800,  1600, 2100, 2620, 3140], // 1h mean
        co:   [0, 5,   10,   35,   60,   90,   120,  150],  // 1h mean (mg/m³)
        pm25: [0, 35,  75,   115,  150,  250,  350,  500],  // 24h mean (used for real-time reporting)
        pm10: [0, 50,  150,  250,  350,  420,  500,  600]   // 24h mean (used for real-time reporting)
    },

    /**
     * Converts AQI to Concentration
     * @param {number} iaqi - Individual AQI value
     * @param {string} pollutant - 'o3', 'no2', 'so2', 'co', 'pm25', 'pm10'
     * @returns {number|null} Concentration value
     */
    toConcentration: function(iaqi, pollutant) {
        if (iaqi === undefined || iaqi === null || isNaN(iaqi)) return null;
        
        const bp = this.breakpoints[pollutant.toLowerCase()];
        if (!bp) return iaqi; // Return original if unknown pollutant

        // Find the interval
        let i = 0;
        for (i = 0; i < this.iaqi_breaks.length - 1; i++) {
            if (iaqi <= this.iaqi_breaks[i + 1]) break;
        }

        const iaqiLow = this.iaqi_breaks[i];
        const iaqiHigh = this.iaqi_breaks[i + 1];
        const bpLow = bp[i];
        const bpHigh = bp[i + 1];

        // Linear interpolation: C = ((AQI - IAQI_low) / (IAQI_high - IAQI_low)) * (BP_high - BP_low) + BP_low
        if (iaqiHigh === iaqiLow) return bpLow;
        
        let conc = ((iaqi - iaqiLow) / (iaqiHigh - iaqiLow)) * (bpHigh - bpLow) + bpLow;

        // Special handling for CO: Convert mg/m³ to μg/m³ as requested by user
        if (pollutant.toLowerCase() === 'co') {
            conc *= 1000;
        }

        // Round to 1 decimal place
        return Math.round(conc * 10) / 10;
    }
};

// Export for ES modules or background scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AQI_CONVERTER;
} else {
    // For browser background scripts
    self.AQI_CONVERTER = AQI_CONVERTER;
}
