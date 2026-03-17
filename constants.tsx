
import { ExamType, Subject, Grade, ExamStructure, EducationLevel } from './types';

export const EXAM_TYPES: ExamType[] = ['Thường xuyên', 'Giữa Kì', 'Cuối Kì'];

export const EDUCATION_LEVELS: EducationLevel[] = ['Trung học cơ sở', 'Trung học phổ thông'];

export const SUBJECTS_THCS: Subject[] = [
    'Toán', 'Lịch sử và Địa lí', 'Khoa học tự nhiên', 'Công nghệ', 'Tin học', 
    'Giáo dục công dân', 'Âm nhạc', 'Mĩ thuật', 'Giáo dục thể chất', 
    'Hoạt động trải nghiệm – Hướng nghiệp'
];

export const SUBJECTS_THPT: Subject[] = [
    'Toán', 'Lịch sử', 'Địa lí', 'Sinh học', 'Hóa học', 'Vật Lí', 
    'Giáo dục kinh tế pháp luật', 'Công nghệ', 'Tin học', 'Âm nhạc', 
    'Mĩ thuật', 'Giáo dục thể chất', 'Hoạt động trải nghiệm – Hướng nghiệp', 'Quốc phòng'
];

// Default list (can be union of both or specific)
export const SUBJECTS: Subject[] = [...new Set([...SUBJECTS_THCS, ...SUBJECTS_THPT])];

export const GRADES_THCS: Grade[] = ['6', '7', '8', '9'];
export const GRADES_THPT: Grade[] = ['10', '11', '12'];
export const GRADES: Grade[] = [...GRADES_THCS, ...GRADES_THPT];

export const EXAM_STRUCTURES: ExamStructure[] = ['Trắc nghiệm', 'Tự Luận', 'Trắc nghiệm + Tự Luận'];