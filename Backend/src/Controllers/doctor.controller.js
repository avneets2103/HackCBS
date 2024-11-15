import { asyncHandler } from '../Utils/asyncHandler.js';
import ApiError from '../Utils/ApiError.js';
import ApiResponse from '../Utils/ApiResponse.js';
import { User } from '../Models/user.model.js';
import { Patient } from '../Models/patient.model.js';
import { Doctor } from '../Models/doctor.model.js';
import jwt from 'jsonwebtoken';
import { sendingMail } from '../Utils/messagingService.js';
import { getObjectURL } from '../Utils/s3.js';

const generateDoctorToken = async (doctor, patient) => {
    try {
        const doctorToken = await jwt.sign(
            {
                doctorId: doctor._id,
                patientId: patient._id
            },
            process.env.DOCTOR_TOKEN_SECRET,
            {
                expiresIn: process.env.DOCTOR_TOKEN_EXPIRY
            }
        )
        return doctorToken;
    } catch (error) {
        throw new ApiError(
            500,
            'Something went wrong while generating refresh and access token'
        )
    }
}

const getPatientList = asyncHandler(async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('doctorDetails');

        if (!user || !user.doctorDetails) {
            throw new ApiError(404, 'Doctor not found');
        }

        const doctor = await Doctor.findById(user.doctorDetails._id).populate('patientsList');
        if (!doctor) {
            throw new ApiError(404, 'Doctor details not found');
        }

        const patientList = [];
        for (const patient of doctor.patientsList) {
            patient.imageLink = await getObjectURL(patient.imageLink);
            patient.doctorsList = [];
            patientList.push(patient);
        }

        return res.status(200).json(
            new ApiResponse(200, patientList, 'Patient list retrieved successfully')
        );
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in getPatientList');
    }
});

const generatePatientCode = asyncHandler(async (req, res) => {
    try {
        const {patientMail} = req.body;
        const patientUser = await User.findOne({email: patientMail});
        if (!patientUser) {
            throw new ApiError(404, 'Patient not found');
        }
        const doctorToken = await generateDoctorToken(req.user.doctorDetails, patientUser.patientDetails);

        sendingMail(patientMail, "Doctor Token", 'Your Doctor Token is:', `${doctorToken}`);
        return res.status(200).json(
            new ApiResponse(200, doctorToken, 'Patient code generated successfully')
        );
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in generatePatientCode');
    }
});

const getPatientMedical = asyncHandler(async (req, res) => {
    try {
        const { patientId } = req.body;
        const patient = await Patient.findById(patientId).populate('doctorsNotes.doctor'); // Populate doctor data
        if (!patient) {
            throw new ApiError(404, 'Patient not found');
        }
        // Check if the doctor has authorization
        if (!patient.doctorsList.includes(req.user.doctorDetails._id)) {
            throw new ApiError(401, 'Unauthorized access');
        }

        // Generate report list with S3 URLs
        const reportList = await Promise.all(
            patient.reportsList.map(async (report) => {
                report.reportPDFLink = await getObjectURL(report.reportPDFLink);
                return report;
            })
        );

        // Retrieve the specific doctor's note if it exists
        const doctorNoteEntry = patient.doctorsNotes.find(
            (note) => note.doctor._id.toString() === req.user.doctorDetails._id.toString()
        );
        const docNote = doctorNoteEntry ? doctorNoteEntry.note : "";

        reportList.reverse(); // Optional sorting for reports

        const chartsList = patient.chartsList;
        let newChartsList = [];
        for (const chart of chartsList) {
            const newChart = {
                name: chart.chartName,
                data: chart.data,
                description: chart.description,
                sourceList: chart.sourceList,
                queryText: chart.queryText,
                unit: chart.unit
            }
            newChartsList.push(newChart);
        }

        const response = {
            sex: patient.sex,
            age: patient.age,
            bloodGroup: patient.bloodGroup,
            condition: patient.assistiveDiagnosis || "",
            medicalHistory: patient.medicalHistorySummary || "",
            currentSymptoms: patient.currentSymptomsSummary || "",
            reportsList: reportList,
            absoluteSummary: patient.absoluteSummary || "",
            note: docNote,
            chartsList: newChartsList
        };

        return res.status(200).json(
            new ApiResponse(200, response, 'Patient medical history retrieved successfully')
        );
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in getPatientMedical');
    }
});

const saveDoctorNote = asyncHandler(async (req, res) => {
    try {
        const { note, patientId } = req.body;
        const user = await User.findById(req.user._id).populate('doctorDetails');
        if (!user || !user.doctorDetails) {
            throw new ApiError(404, 'Doctor not found');
        }
        
        const doctorId = user.doctorDetails._id;
        const patient = await Patient.findById(patientId);
        if (!patient) {
            throw new ApiError(404, 'Patient not found');
        }

        // Check if this doctor has already left a note
        const existingNote = patient.doctorsNotes.find(
            (docNote) => docNote.doctor.toString() === doctorId.toString()
        );

        if (existingNote) {
            // Update existing note
            existingNote.note = note;
        } else {
            // Add new note entry
            patient.doctorsNotes.push({ doctor: doctorId, note });
        }

        await patient.save();

        return res.status(200).json(
            new ApiResponse(200, {
                patientsList: user.doctorDetails.patientsList, // Return doctor’s patient list
                doctorsList: patient.doctorsList
            }, 'Doctor note saved successfully')
        );
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in saveDoctorNote');
    }
});

const removePatient = asyncHandler(async (req, res) => {
    try {
        const { patientId } = req.body;
        const user = await User.findById(req.user._id).populate('doctorDetails');
        if (!user || !user.doctorDetails) {
            throw new ApiError(404, 'Doctor not found');
        }
        const doctor = await Doctor.findById(user.doctorDetails._id);
        const index = doctor.patientsList.indexOf(patientId);
        if (index > -1) {
            doctor.patientsList.splice(index, 1);
            await doctor.save();
        }
        const patient = await Patient.findById(patientId);
        const index2 = patient.doctorsList.indexOf(user.doctorDetails._id);
        if (index2 > -1) {
            patient.doctorsList.splice(index2, 1);
            await patient.save();
        }
        return res.status(200).json(
            new ApiResponse(200, {
                patientsList: doctor.patientsList,
                doctorsList: patient.doctorsList    
            }, 'Patient removed successfully')
        );
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in removePatient');
    }    
});

export {
    getPatientList,
    generatePatientCode,
    getPatientMedical,
    removePatient,
    saveDoctorNote
};