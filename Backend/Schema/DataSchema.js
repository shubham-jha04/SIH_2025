const mongoose = require("mongoose");

const DataSchema = new mongoose.Schema({
  sampleId: { type: String },              // S. No. (G1, G2, etc.)
  location: { type: String, required: true },
  longitude: { type: Number, required: true },
  latitude: { type: Number, required: true },
  pH: { type: Number },

  EC: { type: Number },                    // EC µS/cm
  TDS: { type: Number },                   // TDS mg/L

  As: { type: Number },                    // Arsenic µg/L
  Cd: { type: Number },                    // Cadmium µg/L
  Cr: { type: Number },                    // Chromium µg/L
  Cu: { type: Number },                    // Copper µg/L
  Fe: { type: Number },                    // Iron µg/L
  Mn: { type: Number },                    // Manganese µg/L
  Ni: { type: Number },                    // Nickel µg/L
  Pb: { type: Number },                    // Lead µg/L
  Zn: { type: Number },                    // Zinc µg/L

  heavyMetalIndex: { type: Number }        // ^ Heavy Metal µg/L
});

module.exports = mongoose.model("GroundwaterData", DataSchema);
