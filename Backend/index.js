const mongoose = require('mongoose');
const express = require('express');
const app = express();
const cors = require('cors');
const xlsx = require('xlsx');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

app.use(cors());
app.use(express.json());

const User = require('./Schema/LogSch.js');
const GroundwaterData = require("./Schema/DataSchema");
const multer = require('multer');

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Helper function to calculate HMPI
function calculateHMPI(data) {
    const standards = {
        As: 10,    // WHO standard in μg/L
        Cd: 3,     // WHO standard in μg/L
        Cr: 50,    // WHO standard in μg/L
        Cu: 2000,  // WHO standard in μg/L
        Fe: 300,   // WHO standard in μg/L
        Mn: 400,   // WHO standard in μg/L
        Ni: 70,    // WHO standard in μg/L
        Pb: 10,    // WHO standard in μg/L
        Zn: 3000   // WHO standard in μg/L
    };

    return data.map(sample => {
        let hmpi = 0;
        let validMetals = 0;

        Object.keys(standards).forEach(metal => {
            if (sample[metal] !== undefined && sample[metal] !== null) {
                const qi = (sample[metal] / standards[metal]) * 100;
                const wi = 1 / standards[metal]; // Weight factor
                hmpi += qi * wi;
                validMetals++;
            }
        });

        const finalHMPI = validMetals > 0 ? hmpi / validMetals : 0;
        
        let status = 'Safe';
        if (finalHMPI > 100) status = 'High Risk';
        else if (finalHMPI > 50) status = 'Moderate Risk';

        return {
            ...sample,
            calculatedHMPI: parseFloat(finalHMPI.toFixed(2)),
            status: status
        };
    });
}

async function main() {
    try {
        await mongoose.connect("mongodb://localhost:27017/HMPI", { useNewUrlParser: true, useUnifiedTopology: true });
        console.log("Connected to MongoDB");

        // User authentication routes
        app.post('/SignUp', async (req, res) => {
            const { email, password } = req.body;
            try {
                const existingUser = await User.findOne({ email })
                if (existingUser) {
                    return res.status(400).json({ message: "User Already Exists" })
                }
                const newUser = new User({ email, password });
                await newUser.save();
                res.status(201).json({ message: "Account Created" });
            } catch (error) {
                res.status(500).json({ message: "Server Error" })
            }
        });

        app.post('/LogIn', async (req, res) => {
            const { email, password } = req.body;
            try {
                const user = await User.findOne({ email });
                if (!user || user.password !== password) {
                    return res.status(401).json({ message: "Invalid Email or Password" })
                }
                res.json({
                    message: "Login Successfully",
                    user: { email: user.email }
                });
            } catch (error) {
                res.status(500).json({ message: "Server error" })
            }
        });

        // File upload route
        app.post("/upload", upload.single("file"), (req, res) => {
            if (!req.file) {
                return res.status(400).json({ message: "No file uploaded" });
            }

            const filePath = req.file.path;
            const fileName = req.file.filename;

            const mapRow = (row) => ({
                sampleId: row["S. No."] || row["Sample ID"] || row["sampleId"],
                location: row["Locations"] || row["Location"] || row["location"],
                longitude: parseFloat(row["Longitude (degrees in decimal)"] || row["Longitude"] || row["longitude"]) || 0,
                latitude: parseFloat(row["Latitude (degrees in decimal)"] || row["Latitude"] || row["latitude"]) || 0,
                pH: parseFloat(row["pH"] || row["ph"]) || 0,
                EC: parseFloat(row["EC μS/cm at 25 °C"] || row["EC"] || row["ec"]) || 0,
                TDS: parseFloat(row["TDS mg/L"] || row["TDS"] || row["tds"]) || 0,
                As: parseFloat(row["As μg/L"] || row["As"] || row["as"]) || 0,
                Cd: parseFloat(row["Cd μg/L"] || row["Cd"] || row["cd"]) || 0,
                Cr: parseFloat(row["Cr μg/L"] || row["Cr"] || row["cr"]) || 0,
                Cu: parseFloat(row["Cu μg/L"] || row["Cu"] || row["cu"]) || 0,
                Fe: parseFloat(row["Fe μg/L"] || row["Fe"] || row["fe"]) || 0,
                Mn: parseFloat(row["Mn μg/L"] || row["Mn"] || row["mn"]) || 0,
                Ni: parseFloat(row["Ni μg/L"] || row["Ni"] || row["ni"]) || 0,
                Pb: parseFloat(row["Pb μg/L"] || row["Pb"] || row["pb"]) || 0,
                Zn: parseFloat(row["Zn μg/L"] || row["Zn"] || row["zn"]) || 0,
                heavyMetalIndex: parseFloat(row["Heavy Metal μg/L"] || row["Heavy Metal"] || row["heavyMetalIndex"]) || 0,
            });

            if (filePath.endsWith(".csv")) {
                const results = [];
                fs.createReadStream(filePath)
                    .pipe(csv())
                    .on("data", (row) => results.push(mapRow(row)))
                    .on("end", async () => {
                        try {
                            await GroundwaterData.insertMany(results);
                            res.json({ 
                                message: "CSV uploaded & saved to DB", 
                                count: results.length,
                                filename: fileName,
                                filePath: `uploads/${fileName}`
                            });
                        } catch (err) {
                            res.status(500).json({ message: "DB Insert Error", error: err });
                        }
                    });
            } else if (filePath.endsWith(".xlsx") || filePath.endsWith(".xls")) {
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const data = xlsx.utils.sheet_to_json(worksheet);

                const mappedData = data.map(mapRow);

                GroundwaterData.insertMany(mappedData)
                    .then(() => res.json({ 
                        message: "Excel uploaded & saved to DB", 
                        count: mappedData.length,
                        filename: fileName,
                        filePath: `uploads/${fileName}`
                    }))
                    .catch((err) => res.status(500).json({ message: "DB Insert Error", error: err }));
            } else {
                res.status(400).json({ message: "Unsupported file format" });
            }
        });

        // Route to view uploaded files
        app.get('/view-file/:filename', (req, res) => {
            const filename = req.params.filename;
            const filePath = path.join(__dirname, 'uploads', filename);
            
            if (fs.existsSync(filePath)) {
                res.sendFile(filePath);
            } else {
                res.status(404).json({ message: "File not found" });
            }
        });

        // Route to analyze all data from database
        app.get('/analyze', async (req, res) => {
            try {
                // Get all data from database
                const data = await GroundwaterData.find({}).lean();

                if (data.length === 0) {
                    return res.json({
                        message: "No data found in database",
                        count: 0,
                        results: [],
                        summary: {
                            totalSamples: 0,
                            safeSamples: 0,
                            moderateRisk: 0,
                            highRisk: 0,
                            averageHMPI: 0
                        }
                    });
                }

                // Calculate HMPI for the data
                const analysisResults = calculateHMPI(data);
                
                res.json({
                    message: "Analysis completed",
                    count: analysisResults.length,
                    results: analysisResults,
                    summary: {
                        totalSamples: analysisResults.length,
                        safeSamples: analysisResults.filter(r => r.status === 'Safe').length,
                        moderateRisk: analysisResults.filter(r => r.status === 'Moderate Risk').length,
                        highRisk: analysisResults.filter(r => r.status === 'High Risk').length,
                        averageHMPI: analysisResults.length > 0 ? analysisResults.reduce((sum, r) => sum + r.calculatedHMPI, 0) / analysisResults.length : 0
                    }
                });
            } catch (error) {
                res.status(500).json({ message: "Analysis error", error: error.message });
            }
        });

        // Route to analyze specific uploaded file
        app.get('/analyze/:filename', async (req, res) => {
            try {
                const filename = req.params.filename;
                const filePath = path.join(__dirname, 'uploads', filename);
                
                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ message: "File not found" });
                }

                // Read and parse the file
                const results = [];
                if (filePath.endsWith('.csv')) {
                    await new Promise((resolve, reject) => {
                        fs.createReadStream(filePath)
                            .pipe(csv())
                            .on('data', (row) => {
                                // Map the row data properly with flexible column names
                                const mappedRow = {
                                    sampleId: row["S. No."] || row["Sample ID"] || row["sampleId"] || '',
                                    location: row["Locations"] || row["Location"] || row["location"] || '',
                                    longitude: parseFloat(row["Longitude (degrees in decimal)"] || row["Longitude"] || row["longitude"]) || 0,
                                    latitude: parseFloat(row["Latitude (degrees in decimal)"] || row["Latitude"] || row["latitude"]) || 0,
                                    pH: parseFloat(row["pH"] || row["ph"]) || 0,
                                    EC: parseFloat(row["EC μS/cm at 25 °C"] || row["EC"] || row["ec"]) || 0,
                                    TDS: parseFloat(row["TDS mg/L"] || row["TDS"] || row["tds"]) || 0,
                                    As: parseFloat(row["As μg/L"] || row["As"] || row["as"]) || 0,
                                    Cd: parseFloat(row["Cd μg/L"] || row["Cd"] || row["cd"]) || 0,
                                    Cr: parseFloat(row["Cr μg/L"] || row["Cr"] || row["cr"]) || 0,
                                    Cu: parseFloat(row["Cu μg/L"] || row["Cu"] || row["cu"]) || 0,
                                    Fe: parseFloat(row["Fe μg/L"] || row["Fe"] || row["fe"]) || 0,
                                    Mn: parseFloat(row["Mn μg/L"] || row["Mn"] || row["mn"]) || 0,
                                    Ni: parseFloat(row["Ni μg/L"] || row["Ni"] || row["ni"]) || 0,
                                    Pb: parseFloat(row["Pb μg/L"] || row["Pb"] || row["pb"]) || 0,
                                    Zn: parseFloat(row["Zn μg/L"] || row["Zn"] || row["zn"]) || 0,
                                };
                                results.push(mappedRow);
                            })
                            .on('end', resolve)
                            .on('error', reject);
                    });
                } else if (filePath.endsWith('.xlsx') || filePath.endsWith('.xls')) {
                    const workbook = xlsx.readFile(filePath);
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const data = xlsx.utils.sheet_to_json(worksheet);
                    
                    data.forEach(row => {
                        const mappedRow = {
                            sampleId: row["S. No."] || row["Sample ID"] || row["sampleId"] || '',
                            location: row["Locations"] || row["Location"] || row["location"] || '',
                            longitude: parseFloat(row["Longitude (degrees in decimal)"] || row["Longitude"] || row["longitude"]) || 0,
                            latitude: parseFloat(row["Latitude (degrees in decimal)"] || row["Latitude"] || row["latitude"]) || 0,
                            pH: parseFloat(row["pH"] || row["ph"]) || 0,
                            EC: parseFloat(row["EC μS/cm at 25 °C"] || row["EC"] || row["ec"]) || 0,
                            TDS: parseFloat(row["TDS mg/L"] || row["TDS"] || row["tds"]) || 0,
                            As: parseFloat(row["As μg/L"] || row["As"] || row["as"]) || 0,
                            Cd: parseFloat(row["Cd μg/L"] || row["Cd"] || row["cd"]) || 0,
                            Cr: parseFloat(row["Cr μg/L"] || row["Cr"] || row["cr"]) || 0,
                            Cu: parseFloat(row["Cu μg/L"] || row["Cu"] || row["cu"]) || 0,
                            Fe: parseFloat(row["Fe μg/L"] || row["Fe"] || row["fe"]) || 0,
                            Mn: parseFloat(row["Mn μg/L"] || row["Mn"] || row["mn"]) || 0,
                            Ni: parseFloat(row["Ni μg/L"] || row["Ni"] || row["ni"]) || 0,
                            Pb: parseFloat(row["Pb μg/L"] || row["Pb"] || row["pb"]) || 0,
                            Zn: parseFloat(row["Zn μg/L"] || row["Zn"] || row["zn"]) || 0,
                        };
                        results.push(mappedRow);
                    });
                }

                if (results.length === 0) {
                    return res.json({
                        message: "No valid data found in file",
                        count: 0,
                        results: [],
                        summary: {
                            totalSamples: 0,
                            safeSamples: 0,
                            moderateRisk: 0,
                            highRisk: 0,
                            averageHMPI: 0
                        }
                    });
                }

                // Calculate HMPI for the data
                const analysisResults = calculateHMPI(results);
                
                res.json({
                    message: "Analysis completed",
                    count: analysisResults.length,
                    results: analysisResults,
                    summary: {
                        totalSamples: analysisResults.length,
                        safeSamples: analysisResults.filter(r => r.status === 'Safe').length,
                        moderateRisk: analysisResults.filter(r => r.status === 'Moderate Risk').length,
                        highRisk: analysisResults.filter(r => r.status === 'High Risk').length,
                        averageHMPI: analysisResults.reduce((sum, r) => sum + r.calculatedHMPI, 0) / analysisResults.length
                    }
                });
            } catch (error) {
                res.status(500).json({ message: "Analysis error", error: error.message });
            }
        });

        // NEW ROUTE: Download pre-existing SampleDataResults.csv
        app.get('/download-sample-report', (req, res) => {
            // Try multiple possible locations for the file
            const possiblePaths = [
                path.join(__dirname, 'SampleDataResults.csv'), // Backend root
                path.join(__dirname, '..', 'SampleDataResults.csv'), // Parent directory
                path.join(__dirname, '..', 'Frontend!', 'SampleDataResults.csv'), // Frontend directory
                'C:\\Users\\hp\\Desktop\\Frontend!\\SampleDataResults.csv' // Absolute path
            ];
            
            let sampleFilePath = null;
            
            // Find the file in one of the possible locations
            for (const filePath of possiblePaths) {
                if (fs.existsSync(filePath)) {
                    sampleFilePath = filePath;
                    break;
                }
            }
            
            if (sampleFilePath) {
                console.log(`Found SampleDataResults.csv at: ${sampleFilePath}`);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="SampleDataResults.csv"');
                res.sendFile(path.resolve(sampleFilePath));
            } else {
                console.log('SampleDataResults.csv not found in any of these locations:');
                possiblePaths.forEach(p => console.log(`  - ${p}`));
                res.status(404).json({ 
                    message: "SampleDataResults.csv not found. Checked locations: " + possiblePaths.join(', ')
                });
            }
        });

        // Route to generate report for all database data
        app.get('/generate-report', async (req, res) => {
            try {
                const data = await GroundwaterData.find({}).lean();

                if (data.length === 0) {
                    return res.status(404).json({ message: "No data found in database" });
                }

                // Calculate HMPI
                const analysisResults = calculateHMPI(data);
                
                // Generate CSV content
                const csvHeader = 'Sample ID,Location,Latitude,Longitude,pH,TDS,As,Cd,Cr,Cu,Fe,Mn,Ni,Pb,Zn,Calculated HMPI,Status\n';
                const csvContent = analysisResults.map(row => 
                    `${row.sampleId || ''},${row.location || ''},${row.latitude || ''},${row.longitude || ''},${row.pH || ''},${row.TDS || ''},${row.As || ''},${row.Cd || ''},${row.Cr || ''},${row.Cu || ''},${row.Fe || ''},${row.Mn || ''},${row.Ni || ''},${row.Pb || ''},${row.Zn || ''},${row.calculatedHMPI},${row.status}`
                ).join('\n');
                
                const fullCsv = csvHeader + csvContent;
                
                // Set response headers for file download
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="HMPI_Analysis_Report.csv"');
                res.send(fullCsv);
                
            } catch (error) {
                res.status(500).json({ message: "Report generation error", error: error.message });
            }
        });

        // Route to generate report for specific file
        app.get('/generate-report/:filename', async (req, res) => {
            try {
                const filename = req.params.filename;
                const filePath = path.join(__dirname, 'uploads', filename);
                
                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ message: "File not found" });
                }

                const results = [];
                if (filePath.endsWith('.csv')) {
                    await new Promise((resolve, reject) => {
                        fs.createReadStream(filePath)
                            .pipe(csv())
                            .on('data', (row) => {
                                const mappedRow = {
                                    sampleId: row["S. No."] || row["Sample ID"] || row["sampleId"] || '',
                                    location: row["Locations"] || row["Location"] || row["location"] || '',
                                    longitude: parseFloat(row["Longitude (degrees in decimal)"] || row["Longitude"] || row["longitude"]) || 0,
                                    latitude: parseFloat(row["Latitude (degrees in decimal)"] || row["Latitude"] || row["latitude"]) || 0,
                                    pH: parseFloat(row["pH"] || row["ph"]) || 0,
                                    EC: parseFloat(row["EC μS/cm at 25 °C"] || row["EC"] || row["ec"]) || 0,
                                    TDS: parseFloat(row["TDS mg/L"] || row["TDS"] || row["tds"]) || 0,
                                    As: parseFloat(row["As μg/L"] || row["As"] || row["as"]) || 0,
                                    Cd: parseFloat(row["Cd μg/L"] || row["Cd"] || row["cd"]) || 0,
                                    Cr: parseFloat(row["Cr μg/L"] || row["Cr"] || row["cr"]) || 0,
                                    Cu: parseFloat(row["Cu μg/L"] || row["Cu"] || row["cu"]) || 0,
                                    Fe: parseFloat(row["Fe μg/L"] || row["Fe"] || row["fe"]) || 0,
                                    Mn: parseFloat(row["Mn μg/L"] || row["Mn"] || row["mn"]) || 0,
                                    Ni: parseFloat(row["Ni μg/L"] || row["Ni"] || row["ni"]) || 0,
                                    Pb: parseFloat(row["Pb μg/L"] || row["Pb"] || row["pb"]) || 0,
                                    Zn: parseFloat(row["Zn μg/L"] || row["Zn"] || row["zn"]) || 0,
                                };
                                results.push(mappedRow);
                            })
                            .on('end', resolve)
                            .on('error', reject);
                    });
                } else if (filePath.endsWith('.xlsx') || filePath.endsWith('.xls')) {
                    const workbook = xlsx.readFile(filePath);
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const data = xlsx.utils.sheet_to_json(worksheet);
                    
                    data.forEach(row => {
                        const mappedRow = {
                            sampleId: row["S. No."] || row["Sample ID"] || row["sampleId"] || '',
                            location: row["Locations"] || row["Location"] || row["location"] || '',
                            longitude: parseFloat(row["Longitude (degrees in decimal)"] || row["Longitude"] || row["longitude"]) || 0,
                            latitude: parseFloat(row["Latitude (degrees in decimal)"] || row["Latitude"] || row["latitude"]) || 0,
                            pH: parseFloat(row["pH"] || row["ph"]) || 0,
                            EC: parseFloat(row["EC μS/cm at 25 °C"] || row["EC"] || row["ec"]) || 0,
                            TDS: parseFloat(row["TDS mg/L"] || row["TDS"] || row["tds"]) || 0,
                            As: parseFloat(row["As μg/L"] || row["As"] || row["as"]) || 0,
                            Cd: parseFloat(row["Cd μg/L"] || row["Cd"] || row["cd"]) || 0,
                            Cr: parseFloat(row["Cr μg/L"] || row["Cr"] || row["cr"]) || 0,
                            Cu: parseFloat(row["Cu μg/L"] || row["Cu"] || row["cu"]) || 0,
                            Fe: parseFloat(row["Fe μg/L"] || row["Fe"] || row["fe"]) || 0,
                            Mn: parseFloat(row["Mn μg/L"] || row["Mn"] || row["mn"]) || 0,
                            Ni: parseFloat(row["Ni μg/L"] || row["Ni"] || row["ni"]) || 0,
                            Pb: parseFloat(row["Pb μg/L"] || row["Pb"] || row["pb"]) || 0,
                            Zn: parseFloat(row["Zn μg/L"] || row["Zn"] || row["zn"]) || 0,
                        };
                        results.push(mappedRow);
                    });
                }

                // Calculate HMPI
                const analysisResults = calculateHMPI(results);
                
                // Generate CSV content
                const csvHeader = 'Sample ID,Location,Latitude,Longitude,pH,TDS,As,Cd,Cr,Cu,Fe,Mn,Ni,Pb,Zn,Calculated HMPI,Status\n';
                const csvContent = analysisResults.map(row => 
                    `${row.sampleId || ''},${row.location || ''},${row.latitude || ''},${row.longitude || ''},${row.pH || ''},${row.TDS || ''},${row.As || ''},${row.Cd || ''},${row.Cr || ''},${row.Cu || ''},${row.Fe || ''},${row.Mn || ''},${row.Ni || ''},${row.Pb || ''},${row.Zn || ''},${row.calculatedHMPI},${row.status}`
                ).join('\n');
                
                const fullCsv = csvHeader + csvContent;
                
                // Set response headers for file download
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="HMPI_Analysis_Report.csv"');
                res.send(fullCsv);
                
            } catch (error) {
                res.status(500).json({ message: "Report generation error", error: error.message });
            }
        });

        // Route to get all uploaded files
        app.get('/files', (req, res) => {
            const uploadsDir = path.join(__dirname, 'uploads');
            
            fs.readdir(uploadsDir, (err, files) => {
                if (err) {
                    return res.status(500).json({ message: "Unable to read uploads directory" });
                }
                
                const fileDetails = files.map(filename => {
                    const filePath = path.join(uploadsDir, filename);
                    const stats = fs.statSync(filePath);
                    
                    return {
                        filename,
                        size: stats.size,
                        uploadDate: stats.birthtime,
                        modifiedDate: stats.mtime
                    };
                });
                
                res.json({ files: fileDetails });
            });
        });

        // Serve uploaded files statically
        app.use("/uploads", express.static(path.join(__dirname, "uploads")));

        // Route to delete uploaded file
        app.delete('/delete-file/:filename', (req, res) => {
            const filename = req.params.filename;
            const filePath = path.join(__dirname, 'uploads', filename);
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                res.json({ message: "File deleted successfully" });
            } else {
                res.status(404).json({ message: "File not found" });
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

app.listen(5999, () => {
    console.log('Server is running on port 5999');
});

main();