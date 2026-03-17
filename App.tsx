import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
    ExamType, Subject, Grade, GenerationMethod, ExamStructure, Objective,
    QuestionCounts, CognitiveLevels, MatrixData, SpecificationData, ExamData, ExamQuestion, TopicRow, SummaryRow, EducationLevel, SpecificationTopic, SpecificationSummaryRow
} from './types';
import { 
    EXAM_TYPES, EXAM_STRUCTURES, EDUCATION_LEVELS,
    GRADES_THCS, GRADES_THPT, 
    SUBJECTS_THCS, SUBJECTS_THPT 
} from './constants';
import { generateExamMatrix, generateSpecificationMatrix, generateFullExam } from './services/geminiService';

// Add XLSX, docx, jspdf, and html2canvas to the window interface for TypeScript
declare const XLSX: any;
declare const jspdf: any;
declare const html2canvas: any;
declare const window: any;

const cleanOptionText = (text: string) => {
    // Removes "A.", "B.", "a)", "b)", etc. followed by optional space from start of string
    return text.replace(/^[A-Da-d][\.\)]\s*/, '');
};

// Helper to render text with subscripts for chemical formulas (e.g., CO2 -> CO₂)
const renderScientificText = (text: string) => {
    if (!text) return null;
    // Regex matches Capital letter + optional lowercase + digits. e.g. O2, He4, C12
    const regex = /([A-Z][a-z]?)(\d+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.substring(lastIndex, match.index));
        }
        parts.push(match[1]);
        parts.push(<sub key={match.index}>{match[2]}</sub>);
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
    }
    return <>{parts}</>;
};

// Helper to parse text into Docx TextRuns with subscripts
const parseTextToDocxRuns = (text: string, options: { bold?: boolean, italics?: boolean } = {}) => {
    if (!text) return [];
    const regex = /([A-Z][a-z]?)(\d+)/g;
    const runs = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        // Text before match
        if (match.index > lastIndex) {
            runs.push(new window.docx.TextRun({
                text: text.substring(lastIndex, match.index),
                bold: options.bold,
                italics: options.italics
            }));
        }
        // Element (e.g., "O", "He")
        runs.push(new window.docx.TextRun({
            text: match[1],
            bold: options.bold,
            italics: options.italics
        }));
        // Number (subscript)
        runs.push(new window.docx.TextRun({
            text: match[2],
            subScript: true,
            bold: options.bold,
            italics: options.italics
        }));
        lastIndex = regex.lastIndex;
    }
    // Remaining text
    if (lastIndex < text.length) {
         runs.push(new window.docx.TextRun({
            text: text.substring(lastIndex),
            bold: options.bold,
            italics: options.italics
        }));
    }
    return runs;
};

// Helper to convert base64 to Uint8Array for docx images
const base64ToUint8Array = (base64: string) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

// --- EXCEL STYLES CONSTANTS ---
// Using hex codes ensures Excel reads the colors correctly when copied from HTML
const XLS_COLORS = {
    primaryLight: '#FEF3C7',
    blue100: '#DBEAFE',
    blue50: '#EFF6FF',
    yellow100: '#FEF9C3',
    yellow50: '#FEFCE8',
    green100: '#DCFCE7',
    green50: '#F0FDF4',
    red100: '#FEE2E2',
    red50: '#FEF2F2',
    gray200: '#E5E7EB',
    gray100: '#F3F4F6',
    white: '#FFFFFF',
    textRed: '#b91c1c'
};

const XLS_STYLE = {
    table: { borderCollapse: 'collapse' as const, border: '1px solid black', width: '100%' },
    th: { border: '1px solid black', padding: '5px', verticalAlign: 'middle', textAlign: 'center' as const, fontWeight: 'bold', fontSize: '13px' },
    td: { border: '1px solid black', padding: '5px', verticalAlign: 'middle', textAlign: 'center' as const, fontSize: '13px' },
    tdLeft: { border: '1px solid black', padding: '5px', verticalAlign: 'middle', textAlign: 'left' as const, whiteSpace: 'pre-wrap' as const, fontSize: '13px' },
};


const Section: React.FC<{ title: string; children: React.ReactNode; titleClassName?: string; }> = ({ title, children, titleClassName }) => (
    <div className="mb-8">
        <h2 className={`text-xl font-bold mb-4 border-b pb-2 ${titleClassName || 'text-primary'}`}>
            {title}
        </h2>
        {children}
    </div>
);

const CopyIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const DownloadIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

const UploadIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4M16 14l-4-4m0 0l-4 4m4-4v12" />
    </svg>
);

const RegenerateIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120.5 10M20 20l-1.5-1.5A9 9 0 003.5 14" />
    </svg>
);

const TrashIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);

const ShuffleIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
);



// Icons for Overview section
const IconCalendar: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const IconBook: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>;
const IconGraduation: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 14l9-5-9-5-9 5 9 5z" /><path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222 4 2.222V20M1 12l5.373 2.986M23 12l-5.373 2.986" /></svg>;
const IconClipboard: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
const IconClock: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IconTopic: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" /></svg>;
const IconObjective: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2h1a2 2 0 002-2v-1a2 2 0 012-2h1.945M12 4.5v.01m0 15v.01M21.945 11H19a2 2 0 00-2 2v1a2 2 0 01-2 2h-1a2 2 0 01-2-2v-1a2 2 0 00-2-2H2.055a1 1 0 01-.5-1.933L4 7.6a1 1 0 011.5 0l1.25 1.25a1 1 0 001.414 0l1.586-1.586a1 1 0 011.414 0l1.586 1.586a1 1 0 001.414 0l1.25-1.25a1 1 0 011.5 0l2.45 1.47a1 1 0 01.5 1.933z" /></svg>;
const IconMCQ: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>;
const IconTrueFalse: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IconShortAnswer: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;
const IconEssay: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const IconKnow: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
const IconComp: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2V7a2 2 0 012-2h6l2-2h2l-2 2z" /></svg>;
const IconApp: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066 2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
const IconSparkles: React.FC<{className?: string}> = ({className}) => <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-5 w-5 mr-2"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;


const InfoItem: React.FC<{ icon: React.ReactNode; label: string; value: string | number }> = ({ icon, label, value }) => (
    <div className="flex items-center space-x-2 bg-white p-2 rounded-lg shadow-sm">
      <div className="text-primary bg-primary-light p-1 rounded-full">{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="font-bold text-text text-sm">{value}</p>
      </div>
    </div>
);


const App: React.FC = () => {
    // Part 1 State
    const [examType, setExamType] = useState<ExamType>('Giữa Kì');
    const [educationLevel, setEducationLevel] = useState<EducationLevel>('Trung học phổ thông');
    const [subject, setSubject] = useState<Subject>('Sinh học');
    const [grade, setGrade] = useState<Grade>('11');
    const [time, setTime] = useState<number>(45);

    const [generationMethod, setGenerationMethod] = useState<GenerationMethod>('topic');
    const [topic, setTopic] = useState('Bài 1: Quang hợp ở thực vật\nBài 2: Hô hấp ở thực vật');
    const [objectives, setObjectives] = useState<Objective[]>([{ id: 1, topic: '', requirement: '' }]);
    const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

    const [examStructure, setExamStructure] = useState<ExamStructure>('Trắc nghiệm + Tự Luận');
    const [questionCounts, setQuestionCounts] = useState<QuestionCounts>({ objective: 6, trueFalse: 2, shortAnswer: 1, essay: 1 });
    const [cognitiveLevels, setCognitiveLevels] = useState<CognitiveLevels>({ knowledge: 40, comprehension: 30, application: 30 });

    // Part 2 & 3 State
    const [matrixData, setMatrixData] = useState<MatrixData | null>(null);
    const [specificationData, setSpecificationData] = useState<SpecificationData | null>(null);
    const [examData, setExamData] = useState<ExamData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingStep, setLoadingStep] = useState<'matrix' | 'specification' | 'exam' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copiedStatus, setCopiedStatus] = useState<Record<string, boolean>>({});

    // Exam Shuffling State
    const [mixCount, setMixCount] = useState<number>(1);
    const [shuffledExams, setShuffledExams] = useState<{data: ExamData, code: string}[]>([]);

    // DOCX download options
    const [docxFontSize, setDocxFontSize] = useState<number>(12);
    const [docxPrimaryColor, setDocxPrimaryColor] = useState<string>('#D97706');

    // Refs for copying content
    const matrixTableRef = useRef<HTMLTableElement>(null);
    const specificationTableRef = useRef<HTMLTableElement>(null);
    const examContentRef = useRef<HTMLDivElement>(null);
    const answersContentRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isInitialMount = useRef(true);

    // Derived lists based on Education Level
    const availableGrades = useMemo(() => {
        return educationLevel === 'Trung học cơ sở' ? GRADES_THCS : GRADES_THPT;
    }, [educationLevel]);

    const availableSubjects = useMemo(() => {
        return educationLevel === 'Trung học cơ sở' ? SUBJECTS_THCS : SUBJECTS_THPT;
    }, [educationLevel]);

    // Reset Grade and Subject when Education Level changes
    useEffect(() => {
        if (!isInitialMount.current) {
            // Set defaults if current selection is invalid for new level
            // We can just reset to the first item of the new list for simplicity and safety
            setGrade(availableGrades[0]);
            setSubject(availableSubjects[0]);
        }
    }, [educationLevel, availableGrades, availableSubjects]);

    // Effect to synchronize all parts: clear generated data if config changes.
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
        } else {
            // Only clear if not in 'upload' method
            if (generationMethod !== 'upload') {
                setMatrixData(null);
                setSpecificationData(null);
                setExamData(null);
                setShuffledExams([]);
            }
        }
    }, [
        examType, 
        educationLevel,
        subject, 
        grade, 
        time, 
        generationMethod, 
        topic, 
        JSON.stringify(objectives), // For deep comparison of array of objects
        examStructure, 
        JSON.stringify(questionCounts), // For deep comparison of object
        JSON.stringify(cognitiveLevels), // For deep comparison of object
    ]);

    
    const totalQuestions = useMemo(() => {
        let total = 0;
        if (examStructure === 'Trắc nghiệm') {
            total = questionCounts.objective + questionCounts.trueFalse + questionCounts.shortAnswer;
        } else if (examStructure === 'Tự Luận') {
            total = questionCounts.essay;
        } else {
            total = questionCounts.objective + questionCounts.trueFalse + questionCounts.shortAnswer + questionCounts.essay;
        }
        return total;
    }, [examStructure, questionCounts]);

    const totalCognitiveLevel = useMemo(() => {
        return cognitiveLevels.knowledge + cognitiveLevels.comprehension + cognitiveLevels.application;
    }, [cognitiveLevels]);
    
    const isFormValid = useMemo(() => {
        if (time <= 0) return false;
        if (generationMethod === 'topic' && topic.trim() === '') return false;
        if (generationMethod === 'objective') {
            if (objectives.some(obj => obj.topic.trim() === '' || obj.requirement.trim() === '')) {
                return false;
            }
        }
        if (generationMethod === 'upload' && !matrixData) return false;

        if (generationMethod !== 'upload') {
            if (totalQuestions <= 0) return false;
            if (totalCognitiveLevel !== 100) return false;
        }
    
        return true;
    }, [time, generationMethod, topic, objectives, totalQuestions, totalCognitiveLevel, matrixData, questionCounts]);

    const handleAddObjective = () => {
        setObjectives([...objectives, { id: Date.now(), topic: '', requirement: '' }]);
    };

    const handleObjectiveChange = (id: number, field: 'topic' | 'requirement', value: string) => {
        setObjectives(objectives.map(obj => obj.id === id ? { ...obj, [field]: value } : obj));
    };

    const handleExamStructureChange = (newStructure: ExamStructure) => {
        setExamStructure(newStructure);
    
        // Reset question counts based on the newly selected structure for a cleaner UX
        setQuestionCounts(prevCounts => {
            const newCounts = { ...prevCounts };
            if (newStructure === 'Trắc nghiệm') {
                // If switching to MCQ only, clear essay count
                newCounts.essay = 0;
            } else if (newStructure === 'Tự Luận') {
                // If switching to Essay only, clear all MCQ counts
                newCounts.objective = 0;
                newCounts.trueFalse = 0;
                newCounts.shortAnswer = 0;
            }
            // For 'Trắc nghiệm + Tự Luận', we preserve all existing counts
            // as all fields are relevant.
            return newCounts;
        });
    };

    const getConfig = useCallback(() => {
        return {
            examType, educationLevel, subject, grade, time, generationMethod,
            examStructure, questionCounts, cognitiveLevels,
            ...(generationMethod === 'topic' ? { topic } : { objectives })
        };
    }, [examType, educationLevel, subject, grade, time, generationMethod, examStructure, questionCounts, cognitiveLevels, topic, objectives]);

    const handleApiError = useCallback((err: any) => {
        const errorMessage = err.message || 'Đã có lỗi không xác định xảy ra.';
        setError(errorMessage);
    }, []);

    const handleGenerateExamMatrix = useCallback(async (isRegenerate = false) => {
        setError(null);
        if (generationMethod === 'upload') {
            if (!matrixData) {
                setError('Vui lòng tải lên file ma trận đề trước.');
            }
            return;
        }

        if (!isFormValid) {
            setError('Vui lòng điền đầy đủ và chính xác tất cả các thông tin chung.');
            return;
        }
        setIsLoading(true);

        // On any matrix generation, clear all subsequent data
        setSpecificationData(null);
        setExamData(null);
        setShuffledExams([]);

        // If it's a fresh generation, clear the current matrix data to hide the old table
        if (!isRegenerate) {
            setMatrixData(null);
        }

        const config = getConfig();
        
        try {
            setLoadingStep('matrix');
            const matrix = await generateExamMatrix(config);
            setMatrixData(matrix);

        } catch (err: any) {
            handleApiError(err);
        } finally {
            setIsLoading(false);
            setLoadingStep(null);
        }
    }, [getConfig, isFormValid, handleApiError, generationMethod, matrixData]);
    
    const handleGenerateSpecificationMatrix = useCallback(async () => {
        if (!matrixData) {
            setError('Cần tạo ma trận đề trước.');
            return;
        }
        setError(null);
        setIsLoading(true);
        setLoadingStep('specification');
        setSpecificationData(null);
        setExamData(null);
        setShuffledExams([]);

        const config = getConfig();
        
        try {
            const data = await generateSpecificationMatrix(config, matrixData);
            setSpecificationData(data);
        } catch (err: any) {
            handleApiError(err);
        } finally {
            setIsLoading(false);
            setLoadingStep(null);
        }
    }, [getConfig, matrixData, handleApiError]);

    const handleGenerateFullExam = useCallback(async () => {
        if (!matrixData || !specificationData) {
            setError('Cần tạo ma trận đề và ma trận đặc tả trước khi tạo đề thi.');
            return;
        }
        setError(null);
        setIsLoading(true);
        setLoadingStep('exam');
        setExamData(null);
        setShuffledExams([]);

        const config = getConfig();
        const matrices = { matrix: matrixData, specification: specificationData };

        try {
            let data = await generateFullExam(config, matrices);
            setExamData(data);
        } catch (err: any) {
            handleApiError(err);
        } finally {
            setIsLoading(false);
            setLoadingStep(null);
        }
    }, [getConfig, matrixData, specificationData, handleApiError]);

    // --- SHUFFLING LOGIC ---
    // ... (Existing Shuffling Logic - No changes)
    const shuffleArray = (array: any[]) => {
        const newArr = [...array];
        for (let i = newArr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
        }
        return newArr;
    };

    const handleMixExams = () => {
        if (!examData) return;
        
        const generatedExams: {data: ExamData, code: string}[] = [];
        
        for (let i = 0; i < mixCount; i++) {
            const code = (101 + i).toString();
            // Deep clone to avoid mutating original
            const clonedExam: ExamData = JSON.parse(JSON.stringify(examData));
            
            // Group questions by type
            const mcqQuestions = clonedExam.questions.filter(q => q.type.toLowerCase().includes('trắc nghiệm khách quan'));
            const tfQuestions = clonedExam.questions.filter(q => q.type.toLowerCase().includes('đúng/sai'));
            const saQuestions = clonedExam.questions.filter(q => q.type.toLowerCase().includes('trả lời ngắn'));
            const essayQuestions = clonedExam.questions.filter(q => q.type.toLowerCase().includes('tự luận'));

            // 1. Shuffle MCQ Questions
            const shuffledMcq = shuffleArray(mcqQuestions).map((q: ExamQuestion) => {
                // Shuffle Options for each MCQ
                if (q.options && q.options.length > 0 && q.answer) {
                    // Identify index of current answer (A=0, B=1, etc.)
                    const currentAnswerChar = q.answer.trim().charAt(0).toUpperCase();
                    const currentAnswerIndex = currentAnswerChar.charCodeAt(0) - 65;
                    
                    // Create pairs of option text and whether it is correct
                    const optionObjs = q.options.map((opt, idx) => ({
                        text: opt,
                        isCorrect: idx === currentAnswerIndex
                    }));
                    
                    // Shuffle the options
                    const shuffledOptionObjs = shuffleArray(optionObjs);
                    
                    // Reconstruct options array
                    q.options = shuffledOptionObjs.map(o => o.text);
                    
                    // Find new correct answer index
                    const newCorrectIndex = shuffledOptionObjs.findIndex(o => o.isCorrect);
                    if (newCorrectIndex !== -1) {
                        q.answer = String.fromCharCode(65 + newCorrectIndex);
                    }
                }
                return q;
            });

            // 2. Shuffle True/False Questions
            const shuffledTf = shuffleArray(tfQuestions).map((q: ExamQuestion) => {
                // Shuffle sub-questions (a, b, c, d)
                if (q.subQuestions && q.subQuestions.length > 0 && q.answer) {
                    const answerParts = q.answer.split(',').map(s => s.trim());
                    // Map answer parts to subquestions to keep track
                    
                    const subQsWithStatus = q.subQuestions.map((sq, idx) => {
                        const char = String.fromCharCode(97 + idx); // a, b, c, d
                        // Find the part starting with this char
                        const part = answerParts.find(p => p.startsWith(char + '-') || p.startsWith(char + ' -'));
                        const status = part ? part.split('-')[1].trim() : '';
                        return { ...sq, status };
                    });

                    // Shuffle
                    const shuffledSubQs = shuffleArray(subQsWithStatus);

                    // Reconstruct
                    q.subQuestions = shuffledSubQs.map(item => ({ text: item.text, level: item.level }));
                    q.answer = shuffledSubQs.map((item, idx) => `${String.fromCharCode(97 + idx)}-${item.status}`).join(', ');
                }
                return q;
            });

            // 3. Shuffle Short Answer & Essay (Order only)
            const shuffledSa = shuffleArray(saQuestions);
            const shuffledEssay = shuffleArray(essayQuestions);

            // Recombine in order: MCQ -> TF -> SA -> Essay
            clonedExam.questions = [...shuffledMcq, ...shuffledTf, ...shuffledSa, ...shuffledEssay];
            
            generatedExams.push({ data: clonedExam, code: code });
        }

        setShuffledExams(generatedExams);
    };

    const handleCopy = useCallback((key: 'matrix' | 'spec' | 'exam' | 'answers') => {
        let elementToCopy: HTMLElement | null = null;
        let isHtml = false;

        switch (key) {
            case 'matrix':
                elementToCopy = matrixTableRef.current;
                isHtml = true;
                break;
            case 'spec':
                elementToCopy = specificationTableRef.current;
                isHtml = true;
                break;
            case 'exam':
                elementToCopy = examContentRef.current;
                break;
            case 'answers':
                elementToCopy = answersContentRef.current;
                break;
        }

        if (!elementToCopy) return;

        if (isHtml) {
            const htmlContent = (elementToCopy as HTMLTableElement).outerHTML;
            const blobHtml = new Blob([htmlContent], { type: 'text/html' });
            const clipboardItem = new ClipboardItem({ 'text/html': blobHtml });
            navigator.clipboard.write([clipboardItem]).then(() => {
                setCopiedStatus({ [key]: true });
                setTimeout(() => setCopiedStatus(prev => ({ ...prev, [key]: false })), 2000);
            }).catch(err => console.error('Failed to copy HTML content: ', err));
        } else {
            const textContent = elementToCopy.innerText;
            navigator.clipboard.writeText(textContent).then(() => {
                setCopiedStatus({ [key]: true });
                setTimeout(() => setCopiedStatus(prev => ({ ...prev, [key]: false })), 2000);
            }).catch(err => console.error('Failed to copy text content: ', err));
        }
    }, []);

    // --- DOWNLOAD EXCEL LOGIC ---
    // ... (Existing Excel Logic)
    const handleDownloadMatrixExcel = useCallback(() => {
        if (!matrixData) return;

        const wb = XLSX.utils.book_new();
        const ws_data: any[][] = [];

        // Headers construction
        ws_data.push(["TT", "Tên chủ đề/bài", "TNKQ", "", "", "", "", "", "", "", "", "Tự Luận", "", "", "Tổng", "", "", ""]);
        ws_data.push(["", "", "Nhiều lựa chọn", "", "", "Đúng/Sai", "", "", "Trả lời ngắn", "", "", "Biết", "Hiểu", "Vận dụng", "Biết", "Hiểu", "Vận dụng", "Tổng"]);
        ws_data.push(["", "", "Biết", "Hiểu", "Vận dụng", "Biết", "Hiểu", "Vận dụng", "Biết", "Hiểu", "Vận dụng", "", "", "", "", "", "", ""]);

        // Merges
        const merges = [
            { s: { r: 0, c: 0 }, e: { r: 2, c: 0 } }, // TT
            { s: { r: 0, c: 1 }, e: { r: 2, c: 1 } }, // Ten chu de
            { s: { r: 0, c: 2 }, e: { r: 0, c: 10 } }, // TNKQ Header
            { s: { r: 0, c: 11 }, e: { r: 0, c: 13 } }, // Tu Luan Header
            { s: { r: 0, c: 14 }, e: { r: 0, c: 17 } }, // Tong Header
            
            { s: { r: 1, c: 2 }, e: { r: 1, c: 4 } }, // Nhieu lua chon
            { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } }, // Dung/Sai
            { s: { r: 1, c: 8 }, e: { r: 1, c: 10 } }, // Tra loi ngan

            { s: { r: 1, c: 11 }, e: { r: 2, c: 11 } }, // TL Biet
            { s: { r: 1, c: 12 }, e: { r: 2, c: 12 } }, // TL Hieu
            { s: { r: 1, c: 13 }, e: { r: 2, c: 13 } }, // TL Van Dung
            
            { s: { r: 1, c: 14 }, e: { r: 2, c: 14 } }, // Tong Biet
            { s: { r: 1, c: 15 }, e: { r: 2, c: 15 } }, // Tong Hieu
            { s: { r: 1, c: 16 }, e: { r: 2, c: 16 } }, // Tong Van Dung
            { s: { r: 1, c: 17 }, e: { r: 2, c: 17 } }, // Tong Tong
        ];

        // Data Rows
        matrixData.topicRows.forEach(row => {
            const f = (n: number) => n === 0 ? "" : n;
            ws_data.push([
                row.id,
                row.topic,
                f(row.mcq_know), f(row.mcq_comp), f(row.mcq_app),
                f(row.tf_know), f(row.tf_comp), f(row.tf_app),
                f(row.sa_know), f(row.sa_comp), f(row.sa_app),
                f(row.essay_know), f(row.essay_comp), f(row.essay_app),
                f(row.total_know), f(row.total_comp), f(row.total_app), f(row.total_sum)
            ]);
        });

        // Summary Rows
        const firstSummaryRowIndex = 3 + matrixData.topicRows.length;
        matrixData.summaryRows.forEach((row, i) => {
            const f = (n: number) => n === 0 ? "" : n;
             ws_data.push([
                row.label,
                "", // Merge with previous
                f(row.mcq_know), f(row.mcq_comp), f(row.mcq_app),
                f(row.tf_know), f(row.tf_comp), f(row.tf_app),
                f(row.sa_know), f(row.sa_comp), f(row.sa_app),
                f(row.essay_know), f(row.essay_comp), f(row.essay_app),
                f(row.total_know), f(row.total_comp), f(row.total_app), f(row.total_sum)
            ]);
            // Merge the label columns (TT + Topic columns)
            merges.push({ s: { r: firstSummaryRowIndex + i, c: 0 }, e: { r: firstSummaryRowIndex + i, c: 1 } });
        });

        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        ws['!merges'] = merges;

        // Set column widths
        const wscols = [
            { wch: 5 }, { wch: 30 }, 
            { wch: 5 }, { wch: 5 }, { wch: 5 }, 
            { wch: 5 }, { wch: 5 }, { wch: 5 },
            { wch: 5 }, { wch: 5 }, { wch: 5 },
            { wch: 5 }, { wch: 5 }, { wch: 5 },
            { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Ma tran de");
        XLSX.writeFile(wb, "Ma_tran_de_thi.xlsx");
    }, [matrixData]);

    const handleDownloadSampleMatrix = () => {
        // Create dummy data for sample
        const dummyMatrix: MatrixData = {
            topicRows: [
                {
                    id: 1, topic: "Chủ đề 1 (Mẫu)",
                    mcq_know: 1, mcq_comp: 1, mcq_app: 0,
                    tf_know: 1, tf_comp: 0, tf_app: 0,
                    sa_know: 0, sa_comp: 1, sa_app: 0,
                    essay_know: 0, essay_comp: 0, essay_app: 0,
                    total_know: 2, total_comp: 2, total_app: 0, total_sum: 4
                }
            ],
            summaryRows: [
                { label: "Tổng số câu", mcq_know: 1, mcq_comp: 1, mcq_app: 0, tf_know: 1, tf_comp: 0, tf_app: 0, sa_know: 0, sa_comp: 1, sa_app: 0, essay_know: 0, essay_comp: 0, essay_app: 0, total_know: 2, total_comp: 2, total_app: 0, total_sum: 4 },
            ]
        };

        const wb = XLSX.utils.book_new();
        const ws_data: any[][] = [];

        // Headers construction (Identical to handleDownloadMatrixExcel)
        ws_data.push(["TT", "Tên chủ đề/bài", "TNKQ", "", "", "", "", "", "", "", "", "Tự Luận", "", "", "Tổng", "", "", ""]);
        ws_data.push(["", "", "Nhiều lựa chọn", "", "", "Đúng/Sai", "", "", "Trả lời ngắn", "", "", "Biết", "Hiểu", "Vận dụng", "Biết", "Hiểu", "Vận dụng", "Tổng"]);
        ws_data.push(["", "", "Biết", "Hiểu", "Vận dụng", "Biết", "Hiểu", "Vận dụng", "Biết", "Hiểu", "Vận dụng", "", "", "", "", "", "", ""]);

        const merges = [
            { s: { r: 0, c: 0 }, e: { r: 2, c: 0 } },
            { s: { r: 0, c: 1 }, e: { r: 2, c: 1 } },
            { s: { r: 0, c: 2 }, e: { r: 0, c: 10 } },
            { s: { r: 0, c: 11 }, e: { r: 0, c: 13 } },
            { s: { r: 0, c: 14 }, e: { r: 0, c: 17 } },
            { s: { r: 1, c: 2 }, e: { r: 1, c: 4 } },
            { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } },
            { s: { r: 1, c: 8 }, e: { r: 1, c: 10 } },
            { s: { r: 1, c: 11 }, e: { r: 2, c: 11 } },
            { s: { r: 1, c: 12 }, e: { r: 2, c: 12 } },
            { s: { r: 1, c: 13 }, e: { r: 2, c: 13 } },
            { s: { r: 1, c: 14 }, e: { r: 2, c: 14 } },
            { s: { r: 1, c: 15 }, e: { r: 2, c: 15 } },
            { s: { r: 1, c: 16 }, e: { r: 2, c: 16 } },
            { s: { r: 1, c: 17 }, e: { r: 2, c: 17 } },
        ];

        // Data Rows
        dummyMatrix.topicRows.forEach(row => {
            const f = (n: number) => n === 0 ? "" : n;
            ws_data.push([
                row.id, row.topic,
                f(row.mcq_know), f(row.mcq_comp), f(row.mcq_app),
                f(row.tf_know), f(row.tf_comp), f(row.tf_app),
                f(row.sa_know), f(row.sa_comp), f(row.sa_app),
                f(row.essay_know), f(row.essay_comp), f(row.essay_app),
                f(row.total_know), f(row.total_comp), f(row.total_app), f(row.total_sum)
            ]);
        });

        // Summary Rows
        dummyMatrix.summaryRows.forEach((row, i) => {
            const f = (n: number) => n === 0 ? "" : n;
             ws_data.push([
                row.label, "",
                f(row.mcq_know), f(row.mcq_comp), f(row.mcq_app),
                f(row.tf_know), f(row.tf_comp), f(row.tf_app),
                f(row.sa_know), f(row.sa_comp), f(row.sa_app),
                f(row.essay_know), f(row.essay_comp), f(row.essay_app),
                f(row.total_know), f(row.total_comp), f(row.total_app), f(row.total_sum)
            ]);
            merges.push({ s: { r: 4 + i, c: 0 }, e: { r: 4 + i, c: 1 } });
        });

        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        ws['!merges'] = merges;
        const wscols = [{ wch: 5 }, { wch: 30 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Mau_ma_tran");
        XLSX.writeFile(wb, "Mau_Ma_tran_de.xlsx");
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadedFileName(file.name);
        setError(null);
        setMatrixData(null);
        setSpecificationData(null);
        setExamData(null);
        setShuffledExams([]);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

                if (data.length < 4) throw new Error("File không đúng định dạng mẫu.");

                const topicRows: TopicRow[] = [];
                const summaryRows: SummaryRow[] = [];
                let isSummarySection = false;

                // Start parsing from row index 3 (4th row in Excel)
                for (let i = 3; i < data.length; i++) {
                    const row = data[i];
                    if (!row || row.length === 0) continue;

                    // Check for summary row indicators - SAFE STRING CONVERSION
                    const firstCell = String(row[0] || "").trim();
                    if (firstCell && (firstCell.toLowerCase().includes('tổng') || firstCell.toLowerCase().includes('tỉ lệ'))) {
                        isSummarySection = true;
                    }

                    const safeInt = (val: any) => parseInt(val) || 0;

                    if (!isSummarySection) {
                        // It's a topic row
                        if (!row[1]) continue; // Skip if no topic name
                        const topicRow: TopicRow = {
                            id: safeInt(row[0]) || topicRows.length + 1,
                            topic: String(row[1] || ""), // Safe conversion
                            mcq_know: safeInt(row[2]), mcq_comp: safeInt(row[3]), mcq_app: safeInt(row[4]),
                            tf_know: safeInt(row[5]), tf_comp: safeInt(row[6]), tf_app: safeInt(row[7]),
                            sa_know: safeInt(row[8]), sa_comp: safeInt(row[9]), sa_app: safeInt(row[10]),
                            essay_know: safeInt(row[11]), essay_comp: safeInt(row[12]), essay_app: safeInt(row[13]),
                            total_know: safeInt(row[14]), total_comp: safeInt(row[15]), total_app: safeInt(row[16]),
                            total_sum: safeInt(row[17])
                        };
                        topicRows.push(topicRow);
                    } else {
                        // It's a summary row
                        const summaryRow: SummaryRow = {
                            label: firstCell || "",
                            mcq_know: safeInt(row[2]), mcq_comp: safeInt(row[3]), mcq_app: safeInt(row[4]),
                            tf_know: safeInt(row[5]), tf_comp: safeInt(row[6]), tf_app: safeInt(row[7]),
                            sa_know: safeInt(row[8]), sa_comp: safeInt(row[9]), sa_app: safeInt(row[10]),
                            essay_know: safeInt(row[11]), essay_comp: safeInt(row[12]), essay_app: safeInt(row[13]),
                            total_know: safeInt(row[14]), total_comp: safeInt(row[15]), total_app: safeInt(row[16]),
                            total_sum: safeInt(row[17])
                        };
                        summaryRows.push(summaryRow);
                    }
                }

                if (topicRows.length === 0) {
                    throw new Error("Không tìm thấy dữ liệu chủ đề nào.");
                }

                setMatrixData({ topicRows, summaryRows });

            } catch (err: any) {
                console.error("Error parsing Excel:", err);
                setError("Lỗi khi đọc file: " + (err.message || "File không đúng định dạng."));
                setMatrixData(null);
            }
        };
        reader.readAsBinaryString(file);
    };

    // ... (Existing Docx Logic)
    const createDocx = (paragraphs: any[], fileName: string, options: { fontSize: number; primaryColor: string; orientation?: any }) => {
        const FONT_SIZE_HALF_POINTS = options.fontSize * 2;
        const HEADING_1_SIZE = (options.fontSize + 4) * 2;
        const HEADING_2_SIZE = (options.fontSize + 2) * 2;
        const COLOR = options.primaryColor.replace('#', '');

        const doc = new window.docx.Document({
            styles: {
                default: {
                    document: {
                        run: {
                            size: FONT_SIZE_HALF_POINTS,
                            font: "Times New Roman",
                        },
                    },
                },
                paragraphStyles: [
                    {
                        id: "Heading1",
                        name: "Heading 1",
                        basedOn: "Normal",
                        next: "Normal",
                        quickFormat: true,
                        run: {
                            size: HEADING_1_SIZE,
                            bold: true,
                            color: COLOR,
                        },
                        paragraph: {
                            spacing: { after: 120 },
                        },
                    },
                    {
                        id: "Heading2",
                        name: "Heading 2",
                        basedOn: "Normal",
                        next: "Normal",
                        quickFormat: true,
                        run: {
                            size: HEADING_2_SIZE,
                            bold: true,
                            color: COLOR,
                        },
                        paragraph: {
                            spacing: { after: 120 },
                        },
                    },
                ],
            },
            sections: [{
                properties: {
                    page: {
                        size: {
                            orientation: options.orientation || window.docx.PageOrientation.PORTRAIT,
                        },
                    },
                },
                children: paragraphs,
            }],
        });

        window.docx.Packer.toBlob(doc).then((blob: Blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        });
    };

    const handleDownloadMatrixDocx = useCallback(() => {
        if (!matrixData) return;
        // ... (Existing content, just copying to ensure context is kept)
        const table = new window.docx.Table({
            width: { size: 100, type: window.docx.WidthType.PERCENTAGE },
            rows: [
                new window.docx.TableRow({
                    children: [
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "TT", bold: true, alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Tên chủ đề/bài", bold: true, alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "TNKQ", bold: true, alignment: "center" })], columnSpan: 9, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Tự Luận", bold: true, alignment: "center" })], columnSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Tổng", bold: true, alignment: "center" })], columnSpan: 4, verticalAlign: "center" }),
                    ]
                }),
                new window.docx.TableRow({
                    children: [
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Nhiều lựa chọn", bold: true, alignment: "center" })], columnSpan: 3 }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Đúng/Sai", bold: true, alignment: "center" })], columnSpan: 3 }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Trả lời ngắn", bold: true, alignment: "center" })], columnSpan: 3 }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", bold: true, alignment: "center" })], rowSpan: 2, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", bold: true, alignment: "center" })], rowSpan: 2, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận dụng", bold: true, alignment: "center" })], rowSpan: 2, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", bold: true, alignment: "center" })], rowSpan: 2, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", bold: true, alignment: "center" })], rowSpan: 2, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận dụng", bold: true, alignment: "center" })], rowSpan: 2, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Tổng", bold: true, alignment: "center" })], rowSpan: 2, verticalAlign: "center" }),
                    ]
                }),
                new window.docx.TableRow({
                    children: [
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận dụng", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận dụng", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận dụng", alignment: "center" })] }),
                    ]
                }),
                ...matrixData.topicRows.map(row => {
                    const f = (n: number) => n === 0 ? "" : n.toString();
                    return new window.docx.TableRow({
                        children: [
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: row.id.toString(), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: row.topic })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_sum), alignment: "center" })] }),
                        ]
                    });
                }),
                ...matrixData.summaryRows.map(row => {
                    const f = (n: number) => n === 0 ? "" : n.toString();
                    return new window.docx.TableRow({
                        children: [
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: row.label, bold: true, alignment: "center" })], columnSpan: 2 }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.total_sum), alignment: "center" })] }),
                        ]
                    });
                })
            ]
        });

        const paragraphs = [
            new window.docx.Paragraph({ text: "MA TRẬN ĐỀ THI", heading: window.docx.HeadingLevel.HEADING_1, alignment: window.docx.AlignmentType.CENTER }),
            new window.docx.Paragraph({ text: "" }),
            table
        ];

        createDocx(paragraphs, "Ma_tran_de_thi.docx", { fontSize: docxFontSize, primaryColor: docxPrimaryColor, orientation: window.docx.PageOrientation.LANDSCAPE });
    }, [matrixData, docxFontSize, docxPrimaryColor]);

    const handleDownloadSpecificationDocx = useCallback(() => {
        if (!specificationData) return;
        // ... (Existing content)
        const table = new window.docx.Table({
            width: { size: 100, type: window.docx.WidthType.PERCENTAGE },
            rows: [
                new window.docx.TableRow({
                    children: [
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "TT", bold: true, alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Bài Học/Chủ Đề", bold: true, alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Mức độ", bold: true, alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Yêu cầu cần đạt", bold: true, alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Câu", bold: true, alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Trắc Nghiệm", bold: true, alignment: "center" })], columnSpan: 9, verticalAlign: "center" }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Tự Luận", bold: true, alignment: "center" })], columnSpan: 3, verticalAlign: "center" }),
                    ]
                }),
                new window.docx.TableRow({
                    children: [
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Nhiều lựa chọn", bold: true, alignment: "center" })], columnSpan: 3 }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Đúng - Sai", bold: true, alignment: "center" })], columnSpan: 3 }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Trả lời ngắn (nếu có)", bold: true, alignment: "center" })], columnSpan: 3 }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Tự luận", bold: true, alignment: "center" })], columnSpan: 3 }),
                    ]
                }),
                new window.docx.TableRow({
                    children: [
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận Dụng", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận Dụng", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận Dụng", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Biết", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Hiểu", alignment: "center" })] }),
                        new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "Vận Dụng", alignment: "center" })] }),
                    ]
                }),
                ...specificationData.topics.flatMap((topic, i) => {
                    const qn = topic.questionNumbers;
                    const f = (n: number) => n === 0 ? "" : n.toString();
                    
                    const formatQ = (s: string | undefined) => s ? s.trim() : '';
                    
                    const knowledgeNumbers = [formatQ(qn.mcq.knowledge), formatQ(qn.tf.knowledge), formatQ(qn.sa.knowledge), formatQ(qn.essay.knowledge)].filter(Boolean).join(', ');
                    const comprehensionNumbers = [formatQ(qn.mcq.comprehension), formatQ(qn.tf.comprehension), formatQ(qn.sa.comprehension), formatQ(qn.essay.comprehension)].filter(Boolean).join(', ');
                    const applicationNumbers = [formatQ(qn.mcq.application), formatQ(qn.tf.application), formatQ(qn.sa.application), formatQ(qn.essay.application)].filter(Boolean).join(', ');

                    return [
                        new window.docx.TableRow({
                            children: [
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: (i + 1).toString(), alignment: "center" })], rowSpan: 3, verticalAlign: "center" }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: topic.content })], rowSpan: 3, verticalAlign: "center" }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "*Biết:", bold: true })] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: topic.requirements.knowledge })] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: knowledgeNumbers, alignment: "center" })] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.mcq_know), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.tf_know), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.sa_know), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.essay_know), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                            ]
                        }),
                        new window.docx.TableRow({
                            children: [
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "*Hiểu:", bold: true })] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: topic.requirements.comprehension })] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: comprehensionNumbers, alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.mcq_comp), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.tf_comp), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.sa_comp), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.essay_comp), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                            ]
                        }),
                        new window.docx.TableRow({
                            children: [
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: "*Vận dụng:", bold: true })] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: topic.requirements.application })] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: applicationNumbers, alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.mcq_app), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.tf_app), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.sa_app), alignment: "center" })] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [] }),
                                new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(topic.essay_app), alignment: "center" })] }),
                            ]
                        }),
                    ]
                }),
                ...specificationData.summaryRows.map(row => {
                    const f = (n: number) => n === 0 ? "" : n.toString();
                    return new window.docx.TableRow({
                        children: [
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: row.label, bold: true, alignment: "center" })], columnSpan: 5 }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.mcq_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.tf_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.sa_app), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_know), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_comp), alignment: "center" })] }),
                            new window.docx.TableCell({ children: [new window.docx.Paragraph({ text: f(row.essay_app), alignment: "center" })] }),
                        ]
                    });
                })
            ]
        });

        const paragraphs = [
            new window.docx.Paragraph({ text: "MA TRẬN ĐẶC TẢ ĐỀ KIỂM TRA", heading: window.docx.HeadingLevel.HEADING_1, alignment: window.docx.AlignmentType.CENTER }),
            new window.docx.Paragraph({ text: "" }),
            table
        ];

        createDocx(paragraphs, "Ma_tran_dac_ta.docx", { fontSize: docxFontSize, primaryColor: docxPrimaryColor, orientation: window.docx.PageOrientation.LANDSCAPE });
    }, [specificationData, docxFontSize, docxPrimaryColor]);

    const handleDownloadSpecificationExcel = useCallback(() => {
        if (!specificationData) return;

        const wb = XLSX.utils.book_new();
        const ws_data: any[][] = [];

        // Headers construction
        ws_data.push(["TT", "Bài Học/Chủ Đề", "Mức độ", "Yêu cầu cần đạt", "Câu", "Trắc Nghiệm", "", "", "", "", "", "", "", "", "Tự Luận", "", ""]);
        ws_data.push(["", "", "", "", "", "Nhiều lựa chọn", "", "", "Đúng - Sai", "", "", "Trả lời ngắn (nếu có)", "", "", "Tự luận", "", ""]);
        ws_data.push(["", "", "", "", "", "Biết", "Hiểu", "Vận Dụng", "Biết", "Hiểu", "Vận Dụng", "Biết", "Hiểu", "Vận Dụng", "Biết", "Hiểu", "Vận Dụng"]);

        // Merges
        const merges = [
            { s: { r: 0, c: 0 }, e: { r: 2, c: 0 } }, // TT
            { s: { r: 0, c: 1 }, e: { r: 2, c: 1 } }, // Content
            { s: { r: 0, c: 2 }, e: { r: 2, c: 2 } }, // Level
            { s: { r: 0, c: 3 }, e: { r: 2, c: 3 } }, // Requirement
            { s: { r: 0, c: 4 }, e: { r: 2, c: 4 } }, // Question numbers

            { s: { r: 0, c: 5 }, e: { r: 0, c: 13 } }, // TNKQ Header
            { s: { r: 0, c: 14 }, e: { r: 0, c: 16 } }, // Tu Luan Header

            { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } }, // Nhieu lua chon
            { s: { r: 1, c: 8 }, e: { r: 1, c: 10 } }, // Dung/Sai
            { s: { r: 1, c: 11 }, e: { r: 1, c: 13 } }, // Tra loi ngan
            { s: { r: 1, c: 14 }, e: { r: 1, c: 16 } }, // Tu Luan sub
        ];

        let currentRow = 3;

        specificationData.topics.forEach((topic, i) => {
            const qn = topic.questionNumbers;
            const f = (n: number) => n === 0 ? "" : n;
            
            const knowledgeNumbers = [qn.mcq.knowledge, qn.tf.knowledge, qn.sa.knowledge, qn.essay.knowledge].map(s => s ? s.trim() : '').filter(Boolean).join(', ');
            const comprehensionNumbers = [qn.mcq.comprehension, qn.tf.comprehension, qn.sa.comprehension, qn.essay.comprehension].map(s => s ? s.trim() : '').filter(Boolean).join(', ');
            const applicationNumbers = [qn.mcq.application, qn.tf.application, qn.sa.application, qn.essay.application].map(s => s ? s.trim() : '').filter(Boolean).join(', ');

            // Row 1: Knowledge
            ws_data.push([
                i + 1,
                topic.content,
                "*Biết",
                topic.requirements.knowledge,
                knowledgeNumbers,
                f(topic.mcq_know), "", "",
                f(topic.tf_know), "", "",
                f(topic.sa_know), "", "",
                f(topic.essay_know), "", ""
            ]);

            // Row 2: Comprehension
            ws_data.push([
                "",
                "",
                "*Hiểu",
                topic.requirements.comprehension,
                comprehensionNumbers,
                "", f(topic.mcq_comp), "",
                "", f(topic.tf_comp), "",
                "", f(topic.sa_comp), "",
                "", f(topic.essay_comp), ""
            ]);

            // Row 3: Application
            ws_data.push([
                "",
                "",
                "*Vận dụng",
                topic.requirements.application,
                applicationNumbers,
                "", "", f(topic.mcq_app),
                "", "", f(topic.tf_app),
                "", "", f(topic.sa_app),
                "", "", f(topic.essay_app)
            ]);

            // Merges for TT and Content across 3 rows
            merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow + 2, c: 0 } });
            merges.push({ s: { r: currentRow, c: 1 }, e: { r: currentRow + 2, c: 1 } });

            currentRow += 3;
        });

        // Summary rows
        specificationData.summaryRows.forEach((row, i) => {
            const f = (n: number) => n === 0 ? "" : n;
            ws_data.push([
                row.label, "", "", "", "",
                f(row.mcq_know), f(row.mcq_comp), f(row.mcq_app),
                f(row.tf_know), f(row.tf_comp), f(row.tf_app),
                f(row.sa_know), f(row.sa_comp), f(row.sa_app),
                f(row.essay_know), f(row.essay_comp), f(row.essay_app),
            ]);
            // Merge first 5 columns for Label
            merges.push({ s: { r: currentRow + i, c: 0 }, e: { r: currentRow + i, c: 4 } });
        });

        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        ws['!merges'] = merges;
        
        // Col widths
        ws['!cols'] = [
            { wch: 5 }, { wch: 30 }, { wch: 10 }, { wch: 40 }, { wch: 10 },
            { wch: 5 }, { wch: 5 }, { wch: 5 },
            { wch: 5 }, { wch: 5 }, { wch: 5 },
            { wch: 5 }, { wch: 5 }, { wch: 5 },
            { wch: 5 }, { wch: 5 }, { wch: 5 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Ma_tran_dac_ta");
        XLSX.writeFile(wb, "Ma_tran_dac_ta.xlsx");
    }, [specificationData]);

    const handleDownloadExamDocx = useCallback((data: ExamData | null = null, filename: string = "De_thi.docx") => {
        const dataToUse = data || examData;
        if (!dataToUse) return;
        const { questions, header } = dataToUse;

        const paragraphs: any[] = [
            new window.docx.Paragraph({ text: `KÌ THI ${header.examType.toUpperCase()}`, heading: window.docx.HeadingLevel.HEADING_1, alignment: window.docx.AlignmentType.CENTER }),
            new window.docx.Paragraph({ text: `MÔN: ${header.subject.toUpperCase()}`, heading: window.docx.HeadingLevel.HEADING_2, alignment: window.docx.AlignmentType.CENTER }),
            new window.docx.Paragraph({ text: `Thời gian làm bài: ${header.time} phút`, bold: true, alignment: window.docx.AlignmentType.CENTER }),
            new window.docx.Paragraph({ text: '' }), // Spacer
        ];
        
        // Use lowercase comparison for robustness
        const questionGroups = [
            { type: 'Trắc nghiệm khách quan', questions: questions.filter(q => q.type.toLowerCase().includes('trắc nghiệm khách quan')), headerTemplate: `Thí sinh trả lời từ câu {start} đến câu {end}. Mỗi câu hỏi thí sinh chỉ chọn một phương án.`},
            { type: 'Đúng/Sai', questions: questions.filter(q => q.type.toLowerCase().includes('đúng/sai')), headerTemplate: `Thí sinh trả lời từ câu {start} đến câu {end}. Trong mỗi ý a), b), c), d) ở mỗi câu, thí sinh chọn đúng hoặc sai.`},
            { type: 'Trả lời ngắn', questions: questions.filter(q => q.type.toLowerCase().includes('trả lời ngắn')), headerTemplate: `Thí sinh trả lời từ câu {start} đến câu {end}.`},
            { type: 'Tự luận', questions: questions.filter(q => q.type.toLowerCase().includes('tự luận')), headerTemplate: `Tự Luận.`}
        ];

        let questionOffset = 0;
        let partCounter = 0;
        const partHeaders = ['I', 'II', 'III', 'IV', 'V'];

        questionGroups.forEach(group => {
            if (group.questions.length === 0) return;

            const partNumber = partHeaders[partCounter++];
            const startNum = questionOffset + 1;
            const endNum = questionOffset + group.questions.length;
            
            let headerText = `PHẦN ${partNumber}. `;
            if (group.type === 'Tự luận') {
                headerText += group.headerTemplate;
            } else if (group.type.includes('Đúng/Sai') || group.type.includes('Trả lời ngắn')) {
                const restartStartNum = 1;
                const restartEndNum = group.questions.length;
                headerText += group.headerTemplate.replace('{start}', restartStartNum.toString()).replace('{end}', restartEndNum.toString());
            }
            else {
                headerText += group.headerTemplate.replace('{start}', startNum.toString()).replace('{end}', endNum.toString());
            }
            paragraphs.push(new window.docx.Paragraph({ text: headerText, bold: true }));
            
            group.questions.forEach((q, index) => {
                const questionNumber = (group.type.includes('Đúng/Sai') || group.type.includes('Trả lời ngắn') || group.type.includes('Tự luận')) ? index + 1 : questionOffset + index + 1;
                paragraphs.push(new window.docx.Paragraph({
                    children: [
                        new window.docx.TextRun({ text: `Câu ${questionNumber}. `, bold: true }),
                        ...parseTextToDocxRuns(q.question),
                    ]
                }));

                // ADD IMAGE TO DOCX
                if (q.image) {
                    const imageBuffer = base64ToUint8Array(q.image);
                    paragraphs.push(new window.docx.Paragraph({
                        children: [
                            new window.docx.ImageRun({
                                data: imageBuffer,
                                transformation: { width: 300, height: 300 }, // Adjust size as needed, roughly 300px
                                type: "png" // Assuming png from Gemini flash-image, but works for jpeg too usually
                            })
                        ],
                        alignment: window.docx.AlignmentType.CENTER,
                        spacing: { after: 120 }
                    }));
                }
                // Fallback for description if image failed but description exists
                else if (q.imageDescription) {
                    paragraphs.push(new window.docx.Paragraph({
                        children: [
                            new window.docx.TextRun({ text: `[HÌNH ẢNH: ${q.imageDescription}]`, bold: true, italics: true, color: "1E40AF" }),
                        ],
                        indent: { left: 720 }, // 0.5 inch
                    }));
                }

                if(group.type === 'Trắc nghiệm khách quan') {
                    q.options?.forEach((opt, i) => {
                        paragraphs.push(new window.docx.Paragraph({
                            children: [
                                new window.docx.TextRun(`${String.fromCharCode(65 + i)}. `),
                                ...parseTextToDocxRuns(cleanOptionText(opt)),
                            ],
                            indent: { left: 720 }, // 0.5 inch
                        }));
                    });
                }
                if (group.type === 'Đúng/Sai') {
                    q.subQuestions?.forEach((subQ, i) => {
                         paragraphs.push(new window.docx.Paragraph({
                            children: [
                                new window.docx.TextRun(`${String.fromCharCode(97 + i)}) `),
                                ...parseTextToDocxRuns(subQ.text),
                                new window.docx.TextRun({ text: ` (${subQ.level})`, bold: true, italics: true }),
                            ],
                            indent: { left: 720 }, // 0.5 inch
                        }));
                    });
                }
            });
            questionOffset += group.questions.length;
        });

        paragraphs.push(new window.docx.Paragraph({ text: '' })); // Spacer
        paragraphs.push(new window.docx.Paragraph({ text: '----------HẾT---------', alignment: window.docx.AlignmentType.CENTER, bold: true }));

        createDocx(paragraphs, filename, { fontSize: docxFontSize, primaryColor: docxPrimaryColor });

    }, [examData, docxFontSize, docxPrimaryColor]);


    const handleDownloadAnswersDocx = useCallback((data: ExamData | null = null, filename: string = "Dap_an.docx") => {
        const dataToUse = data || examData;
        if (!dataToUse) return;
        const { questions, header } = dataToUse;

        const paragraphs: any[] = [
            new window.docx.Paragraph({ text: `ĐÁP ÁN KÌ THI ${header.examType.toUpperCase()}`, heading: window.docx.HeadingLevel.HEADING_1, alignment: window.docx.AlignmentType.CENTER }),
            new window.docx.Paragraph({ text: `MÔN: ${header.subject.toUpperCase()}`, heading: window.docx.HeadingLevel.HEADING_2, alignment: window.docx.AlignmentType.CENTER }),
            new window.docx.Paragraph({ text: '' }), // Spacer
        ];
        
        // Use lowercase comparison for robustness
        const questionGroups = [
            { type: 'Trắc nghiệm khách quan', questions: questions.filter(q => q.type.toLowerCase().includes('trắc nghiệm khách quan'))},
            { type: 'Đúng/Sai', questions: questions.filter(q => q.type.toLowerCase().includes('đúng/sai'))},
            { type: 'Trả lời ngắn', questions: questions.filter(q => q.type.toLowerCase().includes('trả lời ngắn'))},
            { type: 'Tự luận', questions: questions.filter(q => q.type.toLowerCase().includes('tự luận'))}
        ];

        let questionOffset = 0;
        let partCounter = 0;
        const partHeaders = ['I', 'II', 'III', 'IV', 'V'];

        const createAnswerParagraphChildren = (question: ExamQuestion) => {
            const children = [
                ...parseTextToDocxRuns(question.answer, {italics: false}),
            ];

            if (question.explanation) {
                children.push(new window.docx.TextRun({ text: ` ..... Giải thích: `, bold: true, italics: true }));
                children.push(...parseTextToDocxRuns(question.explanation, {italics: true}));
            }
            return children;
        };

        questionGroups.forEach(group => {
            if (group.questions.length === 0) return;

            const partNumber = partHeaders[partCounter++];
            paragraphs.push(new window.docx.Paragraph({ text: `Phần ${partNumber}.`, bold: true }));
            
            group.questions.forEach((q, index) => {
                const questionNumber = (group.type.includes('Đúng/Sai') || group.type.includes('Trả lời ngắn') || group.type.includes('Tự luận')) ? index + 1 : questionOffset + index + 1;
                
                if (group.type === 'Đúng/Sai') {
                    paragraphs.push(new window.docx.Paragraph({ text: `Câu ${questionNumber}.`, bold: true }));
                    q.answer.split(',').forEach(part => {
                        const [key, value] = part.trim().split('-');
                        paragraphs.push(new window.docx.Paragraph({ text: `${key}) ${value}`, indent: { left: 720 } }));
                    });
                     if (q.explanation) {
                         paragraphs.push(new window.docx.Paragraph({
                            children: [
                                new window.docx.TextRun({ text: 'Giải thích: ', bold: true, italics: true }),
                                ...parseTextToDocxRuns(q.explanation, {italics: true}),
                            ],
                            indent: { left: 720 }
                        }));
                    }
                } else {
                    paragraphs.push(new window.docx.Paragraph({
                        children: [
                            new window.docx.TextRun({ text: `Câu ${questionNumber}. `, bold: true }),
                            ...createAnswerParagraphChildren(q)
                        ]
                    }));
                }
            });
            questionOffset += group.questions.length;
        });

        createDocx(paragraphs, filename, { fontSize: docxFontSize, primaryColor: docxPrimaryColor });
    }, [examData, docxFontSize, docxPrimaryColor]);
    
    // ... (Existing PDF logic)
    const handleDownloadPdf = useCallback((element: HTMLElement | null, fileName: string, errorMessage: string) => {
        if (!element) return;
    
        html2canvas(element, {
            scale: 2,
            useCORS: true,
            logging: false,
        }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
    
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
    
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
    
            const ratio = canvasWidth / canvasHeight;
            const imgWidth = pdfWidth - 20; // with some margin
            const imgHeight = imgWidth / ratio;
    
            let heightLeft = imgHeight;
            let position = 10; // top margin
    
            pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
            heightLeft -= (pdfHeight - 20); // subtract page height with margins
    
            while (heightLeft > 0) {
                position = -imgHeight + heightLeft + 10; // calculate new position for the next part of the image
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
                heightLeft -= (pdfHeight - 20);
            }
    
            pdf.save(fileName);
        }).catch(err => {
            console.error("Error generating PDF:", err);
            setError(errorMessage);
        });
    }, []);
    
    const handleDownloadExamPdf = useCallback(() => {
        handleDownloadPdf(examContentRef.current, "De_thi.pdf", "Không thể tạo file PDF. Vui lòng thử lại.");
    }, [handleDownloadPdf]);

    const handleDownloadAnswersPdf = useCallback(() => {
        handleDownloadPdf(answersContentRef.current, "Dap_an.pdf", "Không thể tạo file PDF cho đáp án. Vui lòng thử lại.");
    }, [handleDownloadPdf]);
    
    // --- RENDER HELPERS ---
    const renderCell = (value: number | string | undefined | null, bg: string = 'white') => (
        <td className="py-1 px-2 border text-center text-xs" style={{ ...XLS_STYLE.td, backgroundColor: bg }}>
            {value === 0 ? '' : (value || '')}
        </td>
    );
    
    const renderCellWithColor = (value: number | string | undefined | null, type: 'mcq' | 'tf' | 'sa' | 'essay' | 'other', bg: string = 'white') => {
        const displayValue = value === 0 ? '' : (value || '');
        const colorStyle = (displayValue && ['mcq', 'tf', 'sa', 'essay'].includes(type)) ? { color: XLS_COLORS.textRed, fontWeight: 'bold' } : {};

        return (
            <td className={`py-1 px-2 border text-center text-xs ${displayValue && ['mcq', 'tf', 'sa', 'essay'].includes(type) ? 'text-red-700 font-semibold' : ''}`} style={{ ...XLS_STYLE.td, backgroundColor: bg, ...colorStyle }}>
                {displayValue}
            </td>
        );
    };

    const displayMatrix = useMemo<MatrixData | null>(() => {
        if (!matrixData) {
            return null;
        }
        if (!specificationData) {
            return matrixData;
        }
    
        const newDisplayMatrix: MatrixData = JSON.parse(JSON.stringify(matrixData));
    
        newDisplayMatrix.topicRows.forEach((row) => {
            const specTopic = specificationData.topics.find(t => t.id === row.id);
            if (specTopic) {
                const qn = specTopic.questionNumbers;
                (row as any).mcq_know = qn.mcq.knowledge;
                (row as any).mcq_comp = qn.mcq.comprehension;
                (row as any).mcq_app = qn.mcq.application;
                (row as any).tf_know = qn.tf.knowledge;
                (row as any).tf_comp = qn.tf.comprehension;
                (row as any).tf_app = qn.tf.application;
                (row as any).sa_know = qn.sa.knowledge;
                (row as any).sa_comp = qn.sa.comprehension;
                (row as any).sa_app = qn.sa.application;
                (row as any).essay_know = qn.essay.knowledge;
                (row as any).essay_comp = qn.essay.comprehension;
                (row as any).essay_app = qn.essay.application;
            }
        });
    
        return newDisplayMatrix;
    }, [matrixData, specificationData]);

    const renderExamAndAnswers = (isAnswers: boolean) => {
        // ... (Existing rendering logic)
        if (!examData) return null;

        const questionGroups = [
            { 
                type: 'mcq', 
                questions: examData.questions.filter(q => q.type.toLowerCase().includes('trắc nghiệm khách quan')),
                headerTemplate: `Thí sinh trả lời từ câu {start} đến câu {end}. Mỗi câu hỏi thí sinh chỉ chọn một phương án.`
            },
            { 
                type: 'tf', 
                questions: examData.questions.filter(q => q.type.toLowerCase().includes('đúng/sai')),
                headerTemplate: `Thí sinh trả lời từ câu {start} đến câu {end}. Trong mỗi ý a), b), c), d) ở mỗi câu, thí sinh chọn đúng hoặc sai.`
            },
            { 
                type: 'sa', 
                questions: examData.questions.filter(q => q.type.toLowerCase().includes('trả lời ngắn')),
                headerTemplate: `Thí sinh trả lời từ câu {start} đến câu {end}.`
            },
            { 
                type: 'essay', 
                questions: examData.questions.filter(q => q.type.toLowerCase().includes('tự luận')),
                headerTemplate: `Tự Luận.`
            }
        ];

        let questionOffset = 0;
        let partCounter = 0;
        const partHeaders = ['I', 'II', 'III', 'IV', 'V'];

        const renderedSections = questionGroups.map(group => {
            if (group.questions.length === 0) {
                return null;
            }

            const startNum = questionOffset + 1;
            const endNum = questionOffset + group.questions.length;
            const partNumber = partHeaders[partCounter++];
            
            let headerText = isAnswers ? `Phần ${partNumber}.` : `PHẦN ${partNumber}. `;

            if (!isAnswers) {
                if (group.type === 'essay') {
                    headerText += group.headerTemplate;
                } else if (group.type === 'tf' || group.type === 'sa') {
                    const restartStartNum = 1;
                    const restartEndNum = group.questions.length;
                    headerText += group.headerTemplate.replace('{start}', restartStartNum.toString()).replace('{end}', restartEndNum.toString());
                } else {
                    headerText += group.headerTemplate.replace('{start}', startNum.toString()).replace('{end}', endNum.toString());
                }
            }
           
            const sectionHeaderStyle = { fontWeight: 'bold' as const, marginTop: '12pt', marginBottom: '6pt' };
            const questionStyle = { marginBottom: '3pt', marginTop: '0pt', textAlign: 'justify' as const };
            const optionContainerStyle = { paddingLeft: '0.5in', marginBottom: '6pt' };
            const optionStyle = { marginBottom: '0pt', marginTop: '0pt', textAlign: 'justify' as const };
            const itemContainerStyle = { marginBottom: '12pt' };

            const section = (
                <div className="mb-4" key={partNumber}>
                    <p style={sectionHeaderStyle}>{headerText}</p>
                    {group.questions.map((q, index) => {
                        const questionNumber = questionOffset + index + 1;
                        const displayQuestionNumber = (group.type === 'tf' || group.type === 'sa' || group.type === 'essay') 
                                                      ? index + 1 
                                                      : questionNumber;

                        if (isAnswers) {
                            if (group.type === 'tf') {
                                return (
                                    <div key={questionNumber} style={{ marginBottom: '6pt' }}>
                                        <p style={questionStyle}><strong>Câu {displayQuestionNumber}.</strong></p>
                                        <div style={optionContainerStyle}>
                                            {q.answer.split(',').map(part => {
                                                const [key, value] = part.trim().split('-');
                                                return <p key={key} style={optionStyle}>{`${key}) ${value}`}</p>
                                            })}
                                        </div>
                                         {q.explanation && <p style={{ ...optionContainerStyle, fontStyle: 'italic' }}><strong>Giải thích:</strong> {renderScientificText(q.explanation)}</p>}
                                    </div>
                                );
                            }
                            return (
                                <div key={questionNumber} style={{ marginBottom: '6pt' }}>
                                    <p style={questionStyle}><strong>Câu {displayQuestionNumber}.</strong> {renderScientificText(q.answer)}
                                        {q.explanation && <span style={{ fontStyle: 'italic' }}> ..... <strong>Giải thích:</strong> {renderScientificText(q.explanation)}</span>}
                                    </p>
                                </div>
                            );
                        }
                        
                        if (group.type === 'mcq') {
                            return (
                                <div key={questionNumber} style={itemContainerStyle}>
                                    <p style={questionStyle}><strong>Câu {displayQuestionNumber}.</strong> {renderScientificText(q.question)}</p>
                                    {q.image && (
                                        <div className="flex justify-center my-3">
                                            <img src={`data:image/png;base64,${q.image}`} alt="Hình minh họa" className="max-h-64 object-contain border rounded-md shadow-sm" />
                                        </div>
                                    )}
                                    {!q.image && q.imageDescription && (
                                        <p style={{ ...questionStyle, color: '#1E40AF', fontStyle: 'italic', fontWeight: 'bold' }}>[HÌNH ẢNH: {q.imageDescription}]</p>
                                    )}
                                    {q.options && (
                                        <div style={optionContainerStyle}>
                                            {q.options.map((opt, i) => <p key={i} style={optionStyle}>{String.fromCharCode(65 + i)}. {renderScientificText(cleanOptionText(opt))}</p>)}
                                        </div>
                                    )}
                                </div>
                            );
                        }
                        if (group.type === 'tf') {
                            return (
                                <div key={questionNumber} style={itemContainerStyle}>
                                    <p style={questionStyle}><strong>Câu {displayQuestionNumber}:</strong> {renderScientificText(q.question)}</p>
                                    {q.image && (
                                        <div className="flex justify-center my-3">
                                            <img src={`data:image/png;base64,${q.image}`} alt="Hình minh họa" className="max-h-64 object-contain border rounded-md shadow-sm" />
                                        </div>
                                    )}
                                    {!q.image && q.imageDescription && (
                                        <p style={{ ...questionStyle, color: '#1E40AF', fontStyle: 'italic', fontWeight: 'bold' }}>[HÌNH ẢNH: {q.imageDescription}]</p>
                                    )}
                                    {q.subQuestions && (
                                        <div style={optionContainerStyle}>
                                            {q.subQuestions.map((subQ, i) => 
                                                <p key={i} style={optionStyle}>
                                                    {`${String.fromCharCode(97 + i)}) `} {renderScientificText(subQ.text)}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        }
                        return (
                            <div key={questionNumber} style={itemContainerStyle}>
                                <p style={questionStyle}><strong>Câu {displayQuestionNumber}.</strong> {renderScientificText(q.question)}</p>
                                {q.image && (
                                    <div className="flex justify-center my-3">
                                        <img src={`data:image/png;base64,${q.image}`} alt="Hình minh họa" className="max-h-64 object-contain border rounded-md shadow-sm" />
                                    </div>
                                )}
                                {!q.image && q.imageDescription && (
                                    <p style={{ ...questionStyle, color: '#1E40AF', fontStyle: 'italic', fontWeight: 'bold' }}>[HÌNH ẢNH: {q.imageDescription}]</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            );

            questionOffset += group.questions.length;
            return section;
        }).filter(Boolean);

        return <>{renderedSections}</>;
    };

    return (
        <div className="bg-background min-h-screen">
            <header className="bg-white py-4 shadow-md border-b-2 border-gray-100">
                <div className="max-w-[1125px] mx-auto px-4 text-center">
                    <h1 className="text-2xl font-bold text-red-800">Tạo Đề Thi Thông Minh</h1>
                    <p className="text-sm font-medium text-purple-800 mt-1">Tác giả: Thầy Hiển | SĐT: 0966000224</p>
                </div>
            </header>

            <main className="max-w-[1125px] mx-auto p-2 md:p-4">
                 <div className="bg-card shadow-lg rounded-lg p-4 md:p-6 border border-gray-200">
                    {error && (
                        <div className="bg-danger/10 border-l-4 border-danger text-danger p-2 mb-3 rounded-md" role="alert">
                            <p className="font-bold">Lỗi!</p>
                            <p>{error}</p>
                        </div>
                    )}

                    {/* --- Section 1: Exam Configuration --- */}
                    <Section title="Thông tin chung" titleClassName="text-green-800">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                            <div>
                                <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="exam-type">
                                    <IconCalendar className="h-4 w-4 mr-1.5 text-blue-500"/> Kì thi
                                </label>
                                <select id="exam-type" value={examType} onChange={e => setExamType(e.target.value as ExamType)} className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm">
                                    {EXAM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="education-level">
                                    <IconGraduation className="h-4 w-4 mr-1.5 text-blue-500"/> Cấp học
                                </label>
                                <select id="education-level" value={educationLevel} onChange={e => setEducationLevel(e.target.value as EducationLevel)} className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm">
                                    {EDUCATION_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="subject">
                                    <IconBook className="h-4 w-4 mr-1.5 text-blue-500"/> Môn học
                                </label>
                                <select id="subject" value={subject} onChange={e => setSubject(e.target.value as Subject)} className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm">
                                    {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="grade">
                                     <IconGraduation className="h-4 w-4 mr-1.5 text-blue-500"/> Khối lớp
                                </label>
                                <select id="grade" value={grade} onChange={e => setGrade(e.target.value as Grade)} className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm">
                                    {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="time">
                                    <IconClock className="h-4 w-4 mr-1.5 text-blue-500"/> Thời gian (phút)
                                </label>
                                <input
                                    type="number"
                                    id="time"
                                    value={time}
                                    onChange={e => setTime(parseInt(e.target.value, 10))}
                                    className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm"
                                    min="1"
                                />
                            </div>
                        </div>

                        {/* Generation Method */}
                        <div className="mb-3">
                            <h3 className="text-base font-semibold mb-2 text-amber-800">Phương pháp tạo đề</h3>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 text-sm space-y-2 sm:space-y-0 flex-wrap">
                                <label className="flex items-center cursor-pointer">
                                    <input type="radio" name="generationMethod" value="topic" checked={generationMethod === 'topic'} onChange={() => setGenerationMethod('topic')} className="mr-1 h-3 w-3 text-primary focus:ring-primary" />
                                    <IconTopic className="h-5 w-5 mr-1.5 text-amber-700"/>
                                    <span className="font-medium">Dựa trên Bài học / Chủ đề</span>
                                </label>
                                <label className="flex items-center cursor-pointer">
                                    <input type="radio" name="generationMethod" value="objective" checked={generationMethod === 'objective'} onChange={() => setGenerationMethod('objective')} className="mr-1 h-3 w-3 text-primary focus:ring-primary" />
                                    <IconObjective className="h-5 w-5 mr-1.5 text-amber-700"/>
                                    <span className="font-medium">Dựa trên yêu cầu YCCĐ</span>
                                </label>
                                <label className="flex items-center cursor-pointer">
                                    <input type="radio" name="generationMethod" value="upload" checked={generationMethod === 'upload'} onChange={() => setGenerationMethod('upload')} className="mr-1 h-3 w-3 text-primary focus:ring-primary" />
                                    <IconClipboard className="h-5 w-5 mr-1.5 text-amber-700"/>
                                    <span className="font-medium">Từ ma trận có sẵn</span>
                                </label>
                            </div>
                        </div>
                        
                        {generationMethod === 'topic' && (
                            <div className="mb-3">
                                <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="topic">
                                    <IconTopic className="h-4 w-4 mr-1.5 text-blue-500"/>
                                    Nhập tên Bài học / Chủ đề (mỗi bài một dòng)
                                </label>
                                <textarea
                                    id="topic"
                                    value={topic}
                                    onChange={e => setTopic(e.target.value)}
                                    placeholder="Ví dụ:&#10;Bài 1: Quang hợp ở thực vật&#10;Bài 2: Hô hấp ở thực vật"
                                    className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm"
                                    rows={4}
                                />
                            </div>
                        )}
                        
                        {generationMethod === 'objective' && (
                            <div className="mb-3 border p-2 rounded-md">
                                {objectives.map((obj, index) => (
                                    <div key={obj.id} className="flex flex-col gap-1 mb-3 last:mb-0">
                                        <input
                                            type="text"
                                            value={obj.topic}
                                            onChange={e => handleObjectiveChange(obj.id, 'topic', e.target.value)}
                                            placeholder={`Chủ đề ${index + 1}`}
                                            className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm"
                                        />
                                        <textarea
                                            value={obj.requirement}
                                            onChange={e => handleObjectiveChange(obj.id, 'requirement', e.target.value)}
                                            placeholder={`Nhập các Yêu cầu cần đạt cho chủ đề trên (mỗi yêu cầu một dòng)`}
                                            className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm"
                                            rows={3}
                                        />
                                    </div>
                                ))}
                                <button onClick={handleAddObjective} className="text-primary hover:text-primary-hover font-medium text-sm mt-3">+ Thêm YCCĐ</button>
                            </div>
                        )}

                        {generationMethod === 'upload' && (
                            <div className="mb-3 border p-4 rounded-md bg-gray-50">
                                <p className="text-sm font-semibold mb-2 text-gray-700">Tải lên file Ma trận đề (.xlsx) để tạo đặc tả:</p>
                                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                                    <button onClick={handleDownloadSampleMatrix} className="flex items-center text-blue-700 bg-blue-100 hover:bg-blue-200 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                                        <DownloadIcon /> Tải xuống mẫu ma trận (.xlsx)
                                    </button>
                                    <div className="relative">
                                        <input 
                                            type="file" 
                                            ref={fileInputRef}
                                            accept=".xlsx" 
                                            onChange={handleFileUpload}
                                            className="hidden" 
                                        />
                                        <button 
                                            onClick={() => fileInputRef.current?.click()}
                                            className="flex items-center text-white bg-green-600 hover:bg-green-700 px-3 py-2 rounded-md text-sm font-medium transition-colors shadow-sm"
                                        >
                                            <UploadIcon /> Tải lên Ma trận đề mẫu
                                        </button>
                                    </div>
                                </div>
                                {uploadedFileName && (
                                    <div className="mt-2 text-sm text-gray-600 flex items-center">
                                        <span className="font-semibold mr-1">File đã chọn:</span> {uploadedFileName}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Exam Structure */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h3 className="text-base font-semibold mb-2 text-amber-800">Cấu trúc đề thi</h3>
                                <select value={examStructure} onChange={e => handleExamStructureChange(e.target.value as ExamStructure)} className="w-full p-1 border rounded-md mb-2 focus:ring-2 focus:ring-primary-light text-sm">
                                    {EXAM_STRUCTURES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <div className="mt-2">
                                    <h4 className="font-semibold mb-1 text-sm text-amber-800">Số lượng câu hỏi</h4>
                                    <p className="text-xs text-gray-500 mb-1">Tổng số câu: {totalQuestions}</p>
                                    
                                    {/* Question counts inputs */}
                                    {(() => {
                                        const isMcq = examStructure.includes('Trắc nghiệm');
                                        const isEssay = examStructure.includes('Tự Luận');
                                        return (
                                            <>
                                                {isMcq && (
                                                    <div className="flex items-start gap-2 mb-2">
                                                        <div className="flex-1">
                                                            <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="objective-questions">
                                                                <IconMCQ className="h-4 w-4 mr-1.5 text-blue-500"/> Nhiều lựa chọn
                                                            </label>
                                                            <input
                                                                type="number"
                                                                id="objective-questions"
                                                                value={questionCounts.objective}
                                                                onChange={(e) => setQuestionCounts({ ...questionCounts, objective: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                                                className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm mb-1"
                                                                min="0"
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="tf-questions">
                                                                <IconTrueFalse className="h-4 w-4 mr-1.5 text-blue-500"/> Đúng/Sai
                                                            </label>
                                                            <input
                                                                type="number"
                                                                id="tf-questions"
                                                                value={questionCounts.trueFalse}
                                                                onChange={(e) => setQuestionCounts({ ...questionCounts, trueFalse: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                                                className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm mb-1"
                                                                min="0"
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="sa-questions">
                                                                <IconShortAnswer className="h-4 w-4 mr-1.5 text-blue-500"/> Trả lời ngắn
                                                            </label>
                                                            <input
                                                                type="number"
                                                                id="sa-questions"
                                                                value={questionCounts.shortAnswer}
                                                                onChange={(e) => setQuestionCounts({ ...questionCounts, shortAnswer: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                                                className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm mb-1"
                                                                min="0"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                {isEssay && (
                                                    <div className="mb-2">
                                                        <label className="flex items-center text-xs font-medium mb-1 text-blue-800" htmlFor="essay-questions">
                                                            <IconEssay className="h-4 w-4 mr-1.5 text-blue-500"/> Tự luận
                                                        </label>
                                                        <input
                                                            type="number"
                                                            id="essay-questions"
                                                            value={questionCounts.essay}
                                                            onChange={(e) => setQuestionCounts({ ...questionCounts, essay: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                                            className="w-full p-1 border rounded-md focus:ring-2 focus:ring-primary-light text-sm mb-1"
                                                            min="0"
                                                        />
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-base font-semibold mb-2 text-primary">Phân bổ mức độ nhận thức</h3>
                                <p className={`text-xs mb-1 ${totalCognitiveLevel !== 100 ? 'text-danger' : 'text-gray-500'}`}>Tổng tỉ lệ: {totalCognitiveLevel}%</p>
                                <div className="space-y-2">
                                    <div>
                                        <label className="flex items-center text-xs font-medium mb-1 text-blue-600">
                                            <IconKnow className="h-4 w-4 mr-1.5"/> Biết ({cognitiveLevels.knowledge}%)
                                        </label>
                                        <input type="range" min="0" max="100" value={cognitiveLevels.knowledge} onChange={e => setCognitiveLevels({ ...cognitiveLevels, knowledge: parseInt(e.target.value, 10)})} className="w-full accent-blue-500" />
                                    </div>
                                    <div>
                                        <label className="flex items-center text-xs font-medium mb-1 text-yellow-600">
                                            <IconComp className="h-4 w-4 mr-1.5"/> Hiểu ({cognitiveLevels.comprehension}%)
                                        </label>
                                        <input type="range" min="0" max="100" value={cognitiveLevels.comprehension} onChange={e => setCognitiveLevels({ ...cognitiveLevels, comprehension: parseInt(e.target.value, 10)})} className="w-full accent-yellow-500" />
                                    </div>
                                    <div>
                                        <label className="flex items-center text-xs font-medium mb-1 text-red-600">
                                            <IconApp className="h-4 w-4 mr-1.5"/> Vận dụng ({cognitiveLevels.application}%)
                                        </label>
                                        <input type="range" min="0" max="100" value={cognitiveLevels.application} onChange={e => setCognitiveLevels({ ...cognitiveLevels, application: parseInt(e.target.value, 10)})} className="w-full accent-red-500" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Section>
                    
                    {/* --- GENERATE BUTTON --- */}
                    {/* Hide Generate Matrix button if in upload mode, as parsing happens on upload */}
                    {generationMethod !== 'upload' && (
                        <div className="text-center my-6">
                            <button
                                onClick={() => handleGenerateExamMatrix()}
                                disabled={isLoading || !isFormValid}
                                className="inline-flex items-center justify-center border-2 border-red-800 text-red-800 font-bold py-2 px-8 rounded-md bg-gray-50 hover:bg-red-100 disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors shadow-sm text-base"
                            >
                                <IconSparkles className="h-5 w-5 mr-2" />
                                {isLoading && loadingStep === 'matrix' ? 'Đang tạo...' : 'Tạo ma trận'}
                            </button>
                        </div>
                    )}

                    {/* --- Overview Section --- */}
                    {isFormValid && !matrixData && generationMethod !== 'upload' && (
                        <div className="bg-gray-50 shadow-md rounded-xl mb-4 p-3 border border-gray-200">
                            <h2 className="text-lg font-bold text-green-800 mb-2">Tổng quan cấu hình</h2>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <InfoItem icon={<IconCalendar />} label="Kì thi" value={examType} />
                                <InfoItem icon={<IconBook />} label="Môn học" value={subject} />
                                <InfoItem icon={<IconGraduation />} label="Khối" value={grade} />
                                <InfoItem icon={<IconClipboard />} label="Tổng số câu" value={totalQuestions} />
                            </div>
                        </div>
                    )}


                    {/* --- Loading Indicator --- */}
                    {isLoading && (
                        <div className="text-center p-4">
                            <div role="status" className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]">
                                <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">Loading...</span>
                            </div>
                            <p className="mt-2 text-base font-medium">
                                {loadingStep === 'matrix' && 'AI đang phân tích và tạo ma trận đề...'}
                                {loadingStep === 'specification' && 'AI đang xây dựng ma trận đặc tả chi tiết...'}
                                {loadingStep === 'exam' && 'AI đang biên soạn đề thi và đáp án... Quá trình này có thể mất một vài phút.'}
                            </p>
                        </div>
                    )}

                    {/* --- Section 2: Exam Matrix --- */}
                    {displayMatrix && (
                        <>
                        <Section title="Ma trận đề thi">
                            <div className="flex justify-end space-x-1 mb-2">
                                <button onClick={() => handleCopy('matrix')} className="flex items-center bg-gray-200 hover:bg-gray-300 text-xs py-1 px-2 rounded-md transition">
                                    <CopyIcon /> {copiedStatus['matrix'] ? 'Đã sao chép!' : 'Sao chép bảng'}
                                </button>
                                <button onClick={handleDownloadMatrixExcel} className="flex items-center bg-green-100 hover:bg-green-200 text-green-800 text-xs py-1 px-2 rounded-md transition">
                                    <DownloadIcon /> Tải về (.xlsx)
                                </button>
                                <button onClick={handleDownloadMatrixDocx} className="flex items-center bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs py-1 px-2 rounded-md transition">
                                    <DownloadIcon /> Tải về (.docx)
                                </button>
                                {generationMethod !== 'upload' && (
                                    <button onClick={() => handleGenerateExamMatrix(true)} className="flex items-center bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs py-1 px-2 rounded-md transition" disabled={isLoading}>
                                        <RegenerateIcon /> {isLoading && loadingStep === 'matrix' ? 'Đang tạo lại...': 'Tạo lại'}
                                    </button>
                                )}
                            </div>
                            <div className="overflow-x-auto">
                                <table ref={matrixTableRef} className="w-full border-collapse border text-xs" style={{ ...XLS_STYLE.table, tableLayout: 'fixed' }}>
                                    <colgroup>
                                        <col style={{ width: '3%' }} />
                                        <col style={{ width: '15%' }} />
                                        <col span={12} style={{ width: '4%'}} />
                                        <col span={3} style={{ width: '4%'}} />
                                        <col style={{ width: '4%' }} />
                                    </colgroup>
                                    <thead>
                                        <tr className="bg-primary-light font-bold">
                                            <th rowSpan={3} className="py-1 px-2 border align-middle" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.primaryLight }}>TT</th>
                                            <th rowSpan={3} className="py-1 px-2 border align-middle" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.primaryLight }}>Tên chủ đề/bài</th>
                                            <th colSpan={9} className="py-1 px-2 border align-middle bg-blue-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.blue100 }}>TNKQ</th>
                                            <th colSpan={3} className="py-1 px-2 border align-middle bg-red-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.red100 }}>Tự Luận</th>
                                            <th colSpan={4} className="py-1 px-2 border align-middle bg-gray-200" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.gray200 }}>Tổng</th>
                                        </tr>
                                        <tr className="font-bold">
                                            <th colSpan={3} className="py-1 px-2 border align-middle bg-blue-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.blue100 }}>Nhiều lựa chọn</th>
                                            <th colSpan={3} className="py-1 px-2 border align-middle bg-yellow-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.yellow100 }}>Đúng/Sai</th>
                                            <th colSpan={3} className="py-1 px-2 border align-middle bg-green-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.green100 }}>Trả lời ngắn</th>
                                            
                                            <th rowSpan={2} className="py-1 px-2 border align-middle bg-red-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.red100 }}>Biết</th>
                                            <th rowSpan={2} className="py-1 px-2 border align-middle bg-red-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.red100 }}>Hiểu</th>
                                            <th rowSpan={2} className="py-1 px-2 border align-middle bg-red-100" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.red100 }}>Vận dụng</th>

                                            <th rowSpan={2} className="py-1 px-2 border align-middle bg-gray-200" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.gray200 }}>Biết</th>
                                            <th rowSpan={2} className="py-1 px-2 border align-middle bg-gray-200" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.gray200 }}>Hiểu</th>
                                            <th rowSpan={2} className="py-1 px-2 border align-middle bg-gray-200" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.gray200 }}>Vận dụng</th>
                                            <th rowSpan={2} className="py-1 px-2 border align-middle bg-gray-200" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.gray200 }}>Tổng</th>
                                        </tr>
                                        <tr>
                                            {['Biết', 'Hiểu', 'Vận dụng'].map((level, i) =>
                                                <th key={`mcq-${i}`} className="py-1 px-2 border font-normal bg-blue-50" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.blue50, fontWeight: 'normal' }}>{level}</th>
                                            )}
                                            {['Biết', 'Hiểu', 'Vận dụng'].map((level, i) =>
                                                <th key={`tf-${i}`} className="py-1 px-2 border font-normal bg-yellow-50" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.yellow50, fontWeight: 'normal' }}>{level}</th>
                                            )}
                                            {['Biết', 'Hiểu', 'Vận dụng'].map((level, i) =>
                                                <th key={`sa-${i}`} className="py-1 px-2 border font-normal bg-green-50" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.green50, fontWeight: 'normal' }}>{level}</th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayMatrix.topicRows.map((row) => (
                                            <tr key={row.id}>
                                                <td className="py-1 px-2 border text-center" style={{ ...XLS_STYLE.td }}>{row.id}</td>
                                                <td className="py-1 px-2 border text-left" style={{ ...XLS_STYLE.tdLeft }}>{row.topic}</td>
                                                {renderCellWithColor(row.mcq_know, 'mcq')}
                                                {renderCellWithColor(row.mcq_comp, 'mcq')}
                                                {renderCellWithColor(row.mcq_app, 'mcq')}
                                                {renderCellWithColor(row.tf_know, 'tf')}
                                                {renderCellWithColor(row.tf_comp, 'tf')}
                                                {renderCellWithColor(row.tf_app, 'tf')}
                                                {renderCellWithColor(row.sa_know, 'sa')}
                                                {renderCellWithColor(row.sa_comp, 'sa')}
                                                {renderCellWithColor(row.sa_app, 'sa')}
                                                {renderCellWithColor(row.essay_know, 'essay')}
                                                {renderCellWithColor(row.essay_comp, 'essay')}
                                                {renderCellWithColor(row.essay_app, 'essay')}
                                                {renderCell(row.total_know)}
                                                {renderCell(row.total_comp)}
                                                {renderCell(row.total_app)}
                                                {renderCell(row.total_sum)}
                                            </tr>
                                        ))}
                                        {displayMatrix.summaryRows.map((row, index) => (
                                            <tr key={index} className="font-bold bg-gray-100">
                                                <td colSpan={2} className="py-1 px-2 border text-center" style={{ ...XLS_STYLE.td, backgroundColor: XLS_COLORS.gray100, fontWeight: 'bold' }}>{row.label}</td>
                                                {renderCell(row.mcq_know, XLS_COLORS.gray100)}
                                                {renderCell(row.mcq_comp, XLS_COLORS.gray100)}
                                                {renderCell(row.mcq_app, XLS_COLORS.gray100)}
                                                {renderCell(row.tf_know, XLS_COLORS.gray100)}
                                                {renderCell(row.tf_comp, XLS_COLORS.gray100)}
                                                {renderCell(row.tf_app, XLS_COLORS.gray100)}
                                                {renderCell(row.sa_know, XLS_COLORS.gray100)}
                                                {renderCell(row.sa_comp, XLS_COLORS.gray100)}
                                                {renderCell(row.sa_app, XLS_COLORS.gray100)}
                                                {renderCell(row.essay_know, XLS_COLORS.gray100)}
                                                {renderCell(row.essay_comp, XLS_COLORS.gray100)}
                                                {renderCell(row.essay_app, XLS_COLORS.gray100)}
                                                {renderCell(row.total_know, XLS_COLORS.gray100)}
                                                {renderCell(row.total_comp, XLS_COLORS.gray100)}
                                                {renderCell(row.total_app, XLS_COLORS.gray100)}
                                                {renderCell(row.total_sum, XLS_COLORS.gray100)}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>
                        
                        {/* Only show 'Continue' button if we don't have spec data yet (meaning we generated matrix and want to proceed) */}
                        {matrixData && !specificationData && !isLoading && (
                            <div className="text-center my-4">
                                <button
                                    onClick={handleGenerateSpecificationMatrix}
                                    disabled={isLoading}
                                    className="inline-flex items-center justify-center border-2 border-red-800 text-red-800 font-bold py-2 px-4 rounded-full hover:bg-red-100 disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed transition-transform transform hover:scale-105 shadow-lg text-sm"
                                >
                                    <IconSparkles className="h-4 w-4 mr-2"/>
                                    {isLoading && loadingStep === 'specification' ? 'Đang tạo...' : 'Tiếp tục: Tạo ma trận đặc tả'}
                                </button>
                            </div>
                        )}
                        </>
                    )}

                    {/* --- Section 3: Specification Matrix --- */}
                    {specificationData && (
                        <Section title="Ma trận đặc tả">
                            {/* ... Content same as before ... */}
                            <div className="flex justify-end space-x-1 mb-2">
                                <button onClick={() => handleCopy('spec')} className="flex items-center bg-gray-200 hover:bg-gray-300 text-xs py-1 px-2 rounded-md transition">
                                    <CopyIcon /> {copiedStatus['spec'] ? 'Đã sao chép!' : 'Sao chép bảng'}
                                </button>
                                <button onClick={handleDownloadSpecificationExcel} className="flex items-center bg-green-100 hover:bg-green-200 text-green-800 text-xs py-1 px-2 rounded-md transition">
                                    <DownloadIcon /> Tải về (.xlsx)
                                </button>
                                <button onClick={handleDownloadSpecificationDocx} className="flex items-center bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs py-1 px-2 rounded-md transition">
                                    <DownloadIcon /> Tải về (.docx)
                                </button>
                                {/* Only show regenerate button, valid for all remaining methods */}
                                <button onClick={handleGenerateSpecificationMatrix} className="flex items-center bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs py-1 px-2 rounded-md transition" disabled={isLoading}>
                                    <RegenerateIcon /> {isLoading && loadingStep === 'specification' ? 'Đang tạo lại...': 'Tạo lại'}
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table ref={specificationTableRef} className="w-full border-collapse border text-xs" style={XLS_STYLE.table}>
                                    <thead className="bg-primary-light">
                                        <tr>
                                            <th className="p-1 border" rowSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.primaryLight }}>TT</th>
                                            <th className="p-1 border" rowSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.primaryLight }}>Bài Học/Chủ Đề</th>
                                            <th className="p-1 border" rowSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.primaryLight }}>Mức độ</th>
                                            <th className="p-1 border" rowSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.primaryLight, minWidth: '200px' }}>Yêu cầu cần đạt</th>
                                            <th className="p-1 border" rowSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.primaryLight }}>Câu</th>
                                            <th className="p-1 border bg-blue-100" colSpan={9} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.blue100 }}>Trắc Nghiệm</th>
                                            <th className="p-1 border bg-red-100" colSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.red100 }}>Tự Luận</th>
                                        </tr>
                                        <tr>
                                            <th className="p-1 border bg-blue-100" colSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.blue100 }}>Nhiều lựa chọn</th>
                                            <th className="p-1 border bg-yellow-100" colSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.yellow100 }}>Đúng - Sai</th>
                                            <th className="p-1 border bg-green-100" colSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.green100 }}>Trả lời ngắn (nếu có)</th>
                                            <th className="p-1 border bg-red-100" colSpan={3} style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.red100 }}>Tự luận</th>
                                        </tr>
                                        <tr>
                                            {['Biết', 'Hiểu', 'Vận Dụng'].map((l, i) => <th key={`mcq-spec-${i}`} className="p-1 border font-normal bg-blue-50" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.blue50, fontWeight: 'normal' }}>{l}</th>)}
                                            {['Biết', 'Hiểu', 'Vận Dụng'].map((l, i) => <th key={`tf-spec-${i}`} className="p-1 border font-normal bg-yellow-50" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.yellow50, fontWeight: 'normal' }}>{l}</th>)}
                                            {['Biết', 'Hiểu', 'Vận Dụng'].map((l, i) => <th key={`sa-spec-${i}`} className="p-1 border font-normal bg-green-50" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.green50, fontWeight: 'normal' }}>{l}</th>)}
                                            {['Biết', 'Hiểu', 'Vận Dụng'].map((l, i) => <th key={`essay-spec-${i}`} className="p-1 border font-normal bg-red-50" style={{ ...XLS_STYLE.th, backgroundColor: XLS_COLORS.red50, fontWeight: 'normal' }}>{l}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {specificationData.topics.map((topic, i) => {
                                            const qn = topic.questionNumbers;
                                            const knowledgeNumbers = [qn.mcq.knowledge, qn.tf.knowledge, qn.sa.knowledge, qn.essay.knowledge].map(s => s ? s.trim() : '').filter(Boolean).join(', ');
                                            const comprehensionNumbers = [qn.mcq.comprehension, qn.tf.comprehension, qn.sa.comprehension, qn.essay.comprehension].map(s => s ? s.trim() : '').filter(Boolean).join(', ');
                                            const applicationNumbers = [qn.mcq.application, qn.tf.application, qn.sa.application, qn.essay.application].map(s => s ? s.trim() : '').filter(Boolean).join(', ');

                                            return (
                                                <React.Fragment key={topic.id}>
                                                    <tr>
                                                        <td className="p-1 border text-center" rowSpan={3} style={{ ...XLS_STYLE.td }}>{i + 1}</td>
                                                        <td className="p-1 border text-left" rowSpan={3} style={{ ...XLS_STYLE.tdLeft }}>{topic.content}</td>
                                                        <td className="p-1 border text-left" style={{ ...XLS_STYLE.tdLeft }}><span className="font-bold" style={{fontWeight: 'bold'}}>*Biết:</span></td>
                                                        <td className="p-1 border text-left" style={{ ...XLS_STYLE.tdLeft }}>{topic.requirements.knowledge}</td>
                                                        <td className="p-1 border text-center" style={{ ...XLS_STYLE.td }}>{knowledgeNumbers}</td>
                                                        {renderCell(topic.mcq_know)} {renderCell(null)} {renderCell(null)}
                                                        {renderCell(topic.tf_know)} {renderCell(null)} {renderCell(null)}
                                                        {renderCell(topic.sa_know)} {renderCell(null)} {renderCell(null)}
                                                        {renderCell(topic.essay_know)} {renderCell(null)} {renderCell(null)}
                                                    </tr>
                                                    <tr>
                                                        <td className="p-1 border text-left" style={{ ...XLS_STYLE.tdLeft }}><span className="font-bold" style={{fontWeight: 'bold'}}>*Hiểu:</span></td>
                                                        <td className="p-1 border text-left" style={{ ...XLS_STYLE.tdLeft }}>{topic.requirements.comprehension}</td>
                                                        <td className="p-1 border text-center" style={{ ...XLS_STYLE.td }}>{comprehensionNumbers}</td>
                                                        {renderCell(null)} {renderCell(topic.mcq_comp)} {renderCell(null)}
                                                        {renderCell(null)} {renderCell(topic.tf_comp)} {renderCell(null)}
                                                        {renderCell(null)} {renderCell(topic.sa_comp)} {renderCell(null)}
                                                        {renderCell(null)} {renderCell(topic.essay_comp)} {renderCell(null)}
                                                    </tr>
                                                    <tr>
                                                        <td className="p-1 border text-left" style={{ ...XLS_STYLE.tdLeft }}><span className="font-bold" style={{fontWeight: 'bold'}}>*Vận dụng:</span></td>
                                                        <td className="p-1 border text-left" style={{ ...XLS_STYLE.tdLeft }}>{topic.requirements.application}</td>
                                                        <td className="p-1 border text-center" style={{ ...XLS_STYLE.td }}>{applicationNumbers}</td>
                                                        {renderCell(null)} {renderCell(null)} {renderCell(topic.mcq_app)}
                                                        {renderCell(null)} {renderCell(null)} {renderCell(topic.tf_app)}
                                                        {renderCell(null)} {renderCell(null)} {renderCell(topic.sa_app)}
                                                        {renderCell(null)} {renderCell(null)} {renderCell(topic.essay_app)}
                                                    </tr>
                                                </React.Fragment>
                                            )
                                        })}
                                        {specificationData.summaryRows.map((row, i) => (
                                            <tr key={i} className="font-bold bg-gray-100">
                                                <td className="p-1 border text-center" colSpan={5} style={{ ...XLS_STYLE.td, backgroundColor: XLS_COLORS.gray100, fontWeight: 'bold' }}>{row.label}</td>
                                                {renderCell(row.mcq_know, XLS_COLORS.gray100)} {renderCell(row.mcq_comp, XLS_COLORS.gray100)} {renderCell(row.mcq_app, XLS_COLORS.gray100)}
                                                {renderCell(row.tf_know, XLS_COLORS.gray100)} {renderCell(row.tf_comp, XLS_COLORS.gray100)} {renderCell(row.tf_app, XLS_COLORS.gray100)}
                                                {renderCell(row.sa_know, XLS_COLORS.gray100)} {renderCell(row.sa_comp, XLS_COLORS.gray100)} {renderCell(row.sa_app, XLS_COLORS.gray100)}
                                                {renderCell(row.essay_know, XLS_COLORS.gray100)} {renderCell(row.essay_comp, XLS_COLORS.gray100)} {renderCell(row.essay_app, XLS_COLORS.gray100)}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="text-center mt-3">
                                <button onClick={handleGenerateFullExam} disabled={isLoading} className="inline-flex items-center justify-center border-2 border-red-800 text-red-800 font-bold py-2 px-4 rounded-full hover:bg-red-100 disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed transition-transform transform hover:scale-105 shadow-lg text-sm">
                                    <IconSparkles className="h-4 w-4 mr-2"/>
                                    {isLoading && loadingStep === 'exam' ? 'Đang tạo...' : 'Hoàn tất: Tạo đề thi & đáp án'}
                                </button>
                            </div>
                        </Section>
                    )}
                    
                    {/* --- Section 4: Full Exam --- */}
                    {examData && (
                        <Section title="Đề thi và đáp án">
                            {/* ... content same as before ... */}
                            <div className="flex justify-end space-x-1 mb-2">
                                <button onClick={() => handleGenerateFullExam()} className="flex items-center bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs py-1 px-2 rounded-md transition" disabled={isLoading}>
                                    <RegenerateIcon /> {isLoading && loadingStep === 'exam' ? 'Đang tạo lại...': 'Tạo lại'}
                                </button>
                            </div>

                            {/* Download Options */}
                            <div className="mb-4 p-3 bg-gray-50 border rounded-lg">
                                <h4 className="font-semibold text-sm mb-2 text-gray-700">Tùy chọn tải về (.docx)</h4>
                                <div className="flex items-center space-x-6">
                                    <div className="flex items-center space-x-2">
                                        <label htmlFor="docx-font-size" className="text-xs font-medium text-gray-600">Cỡ chữ:</label>
                                        <input
                                            type="number"
                                            id="docx-font-size"
                                            value={docxFontSize}
                                            onChange={e => setDocxFontSize(Math.max(8, Math.min(24, Number(e.target.value))))}
                                            className="w-16 p-1 border rounded-md text-sm focus:ring-2 focus:ring-primary-light"
                                            min="8"
                                            max="24"
                                        />
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <label htmlFor="docx-primary-color" className="text-xs font-medium text-gray-600">Màu tiêu đề chính:</label>
                                        <input
                                            type="color"
                                            id="docx-primary-color"
                                            value={docxPrimaryColor}
                                            onChange={e => setDocxPrimaryColor(e.target.value)}
                                            className="w-7 h-7 p-0.5 border rounded-md cursor-pointer bg-white"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                {/* Exam Column */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-lg font-bold">Đề thi</h3>
                                        <div className="flex space-x-1">
                                            <button onClick={() => handleCopy('exam')} className="flex items-center bg-gray-200 hover:bg-gray-300 text-xs py-1 px-2 rounded-md transition">
                                            <CopyIcon /> {copiedStatus['exam'] ? 'Đã sao chép!' : 'Sao chép'}
                                            </button>
                                            <button onClick={() => handleDownloadExamDocx(null, "De_thi_Goc.docx")} className="flex items-center bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs py-1 px-2 rounded-md transition">
                                                <DownloadIcon /> Tải về (.docx)
                                            </button>
                                            <button onClick={handleDownloadExamPdf} className="flex items-center bg-red-100 hover:bg-red-200 text-red-800 text-xs py-1 px-2 rounded-md transition">
                                                <DownloadIcon /> Tải về (.pdf)
                                            </button>
                                        </div>
                                    </div>
                                    <div ref={examContentRef} className="p-8 border rounded-lg bg-white shadow-sm" style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '13pt', lineHeight: '1.3' }}>
                                        <div style={{ textAlign: 'center', marginBottom: '12pt' }}>
                                            <p style={{ fontWeight: 'bold', margin: '0', fontSize: '14pt' }}>{`KÌ THI ${examData.header.examType.toUpperCase()}`}</p>
                                            <p style={{ fontWeight: 'bold', margin: '0', fontSize: '14pt' }}>MÔN: {examData.header.subject.toUpperCase()}</p>
                                            <p style={{ fontStyle: 'italic', margin: '0' }}>Thời gian làm bài: {examData.header.time} phút</p>
                                        </div>
                                        <hr className="my-2"/>
                                        {renderExamAndAnswers(false)}
                                        <p className='text-center font-bold'>----------HẾT---------</p>
                                    </div>
                                </div>

                                {/* Answers Column */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-lg font-bold">Đáp án và giải thích</h3>
                                        <div className="flex space-x-1">
                                            <button onClick={() => handleCopy('answers')} className="flex items-center bg-gray-200 hover:bg-gray-300 text-xs py-1 px-2 rounded-md transition">
                                            <CopyIcon /> {copiedStatus['answers'] ? 'Đã sao chép!' : 'Sao chép'}
                                            </button>
                                            <button onClick={() => handleDownloadAnswersDocx(null, "Dap_an_Goc.docx")} className="flex items-center bg-green-100 hover:bg-green-200 text-green-800 text-xs py-1 px-2 rounded-md transition">
                                                <DownloadIcon /> Tải về (.docx)
                                            </button>
                                            <button onClick={handleDownloadAnswersPdf} className="flex items-center bg-red-100 hover:bg-red-200 text-red-800 text-xs py-1 px-2 rounded-md transition">
                                                <DownloadIcon /> Tải về (.pdf)
                                            </button>
                                        </div>
                                    </div>
                                    <div ref={answersContentRef} className="p-8 border rounded-lg bg-white shadow-sm" style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '13pt', lineHeight: '1.3' }}>
                                        <div style={{ textAlign: 'center', marginBottom: '12pt' }}>
                                            <p style={{ fontWeight: 'bold', margin: '0', fontSize: '14pt' }}>{`ĐÁP ÁN KÌ THI ${examData.header.examType.toUpperCase()}`}</p>
                                            <p style={{ fontWeight: 'bold', margin: '0', fontSize: '14pt' }}>MÔN: {examData.header.subject.toUpperCase()}</p>
                                        </div>
                                        <hr className="my-2"/>
                                        {renderExamAndAnswers(true)}
                                    </div>
                                </div>
                            </div>

                            {/* Mix Tool Section */}
                            <div className="mt-8 border-t pt-6">
                                <div className="bg-gradient-to-r from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
                                    <h3 className="text-lg font-bold text-orange-800 mb-3 flex items-center">
                                        <ShuffleIcon /> Công cụ trộn đề
                                    </h3>
                                    <p className="text-sm text-gray-600 mb-4">
                                        Tạo ra các mã đề khác nhau bằng cách hoán vị thứ tự câu hỏi và đảo vị trí đáp án (trong từng câu).
                                    </p>
                                    
                                    <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
                                        <div className="flex items-center">
                                            <label htmlFor="mix-count" className="mr-2 text-sm font-medium text-gray-700">Số lượng đề cần trộn:</label>
                                            <input 
                                                type="number" 
                                                id="mix-count" 
                                                min="1" 
                                                max="6" 
                                                value={mixCount}
                                                onChange={(e) => setMixCount(Math.min(6, Math.max(1, parseInt(e.target.value) || 1)))}
                                                className="w-20 p-2 border rounded-md focus:ring-2 focus:ring-orange-300"
                                            />
                                            <span className="ml-2 text-xs text-gray-500">(Tối đa 6)</span>
                                        </div>
                                        <button 
                                            onClick={handleMixExams}
                                            className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 px-6 rounded shadow-md transition-colors flex items-center"
                                        >
                                            <ShuffleIcon /> Trộn ngay
                                        </button>
                                    </div>

                                    {shuffledExams.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 animate-fade-in">
                                            {shuffledExams.map((exam, idx) => (
                                                <div key={idx} className="bg-white p-3 rounded shadow border border-gray-200">
                                                    <div className="font-bold text-gray-800 mb-2 border-b pb-1">Mã đề: {exam.code}</div>
                                                    <div className="flex justify-between gap-2">
                                                        <button 
                                                            onClick={() => handleDownloadExamDocx(exam.data, `De_thi_Ma_${exam.code}.docx`)}
                                                            className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium py-2 px-2 rounded border border-blue-200 flex justify-center items-center"
                                                        >
                                                            <DownloadIcon /> Tải Đề
                                                        </button>
                                                        <button 
                                                            onClick={() => handleDownloadAnswersDocx(exam.data, `Dap_an_Ma_${exam.code}.docx`)}
                                                            className="flex-1 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium py-2 px-2 rounded border border-green-200 flex justify-center items-center"
                                                        >
                                                            <DownloadIcon /> Tải Đáp án
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Section>
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;