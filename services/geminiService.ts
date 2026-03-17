
import { GoogleGenAI, Type } from "@google/genai";
import type { Objective, ExamData, MatrixData, SpecificationData, MatricesData, ExamQuestion } from '../types';

/**
 * Cleans and parses a string to extract a valid JSON object.
 * It handles markdown code blocks and other extraneous text.
 * @param jsonText The raw string from the API response.
 * @returns The parsed JSON object.
 */
function cleanAndParseJson(jsonText: string): any {
    let cleanedText = jsonText.trim();
    
    // Remove markdown ```json ... ``` wrapper if present
    const jsonMatch = cleanedText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
        cleanedText = jsonMatch[1];
    } else {
        // Fallback for cases with just ``` ... ```
        const plainMatch = cleanedText.match(/```\s*([\s\S]*?)\s*```/);
        if(plainMatch && plainMatch[1]) {
            cleanedText = plainMatch[1];
        }
    }

    // Aggressively find the first '{' and last '}' to form a valid JSON string
    const startIndex = cleanedText.indexOf('{');
    const endIndex = cleanedText.lastIndexOf('}');

    if (startIndex > -1 && endIndex > -1 && endIndex > startIndex) {
        cleanedText = cleanedText.substring(startIndex, endIndex + 1);
    }
    
    try {
        return JSON.parse(cleanedText);
    } catch (error) {
        console.error("Failed to parse cleaned JSON:", cleanedText);
        throw new Error("Response from API was not valid JSON, even after cleaning.");
    }
}


const getTotalQuestions = (structure: string, counts: any) => {
    if (structure === 'Trắc nghiệm') {
        return counts.objective + (counts.trueFalse || 0) + counts.shortAnswer;
    } else if (structure === 'Tự Luận') {
        return counts.essay;
    } else { // 'Trắc nghiệm + Tự Luận'
        return counts.objective + (counts.trueFalse || 0) + counts.shortAnswer + counts.essay;
    }
};

const buildBasePrompt = (config: any) => {
    const totalQuestions = getTotalQuestions(config.examStructure, config.questionCounts);
    const counts = config.questionCounts;
    const structure = config.examStructure;
    const tfCount = counts.trueFalse || 0;

    let prompt = `Bạn là một trợ lý chuyên gia trong việc tạo đề thi cho giáo viên tại Việt Nam. Dựa vào các thông tin sau:

Thông tin chi tiết:
- Kì thi: ${config.examType}
- Cấp học: ${config.educationLevel}
- Môn: ${config.subject}
- Khối lớp: ${config.grade}
- Thời gian làm bài: ${config.time} phút
`;

    if (config.generationMethod === 'topic') {
        prompt += `- Dựa trên Bài học/Chủ đề: ${config.topic}\n`;
    } else {
        prompt += `- Dựa trên Yêu cầu cần đạt (YCCĐ):\n`;
        config.objectives.forEach((obj: Objective, index: number) => {
            prompt += `  ${index + 1}. Chủ đề: ${obj.topic}, YCCĐ: ${obj.requirement}\n`;
        });
    }

    prompt += `
Cấu trúc đề:
- Hình thức: ${structure}
- Số lượng câu hỏi (Tổng cộng: ${totalQuestions} câu):
  - Trắc nghiệm khách quan (Nhiều lựa chọn): ${structure.includes('Trắc nghiệm') ? counts.objective : 0} câu
  - Trắc nghiệm Đúng/Sai (Mỗi câu có 4 ý nhỏ): ${structure.includes('Trắc nghiệm') ? tfCount : 0} câu
  - Trắc nghiệm Trả lời ngắn: ${structure.includes('Trắc nghiệm') ? counts.shortAnswer : 0} câu (Yêu cầu điền số)
  - Tự luận: ${structure.includes('Tự Luận') ? counts.essay : 0} câu
- Phân bổ mức độ nhận thức:
  - Mức Biết: ${config.cognitiveLevels.knowledge}%
  - Mức Hiểu: ${config.cognitiveLevels.comprehension}%
  - Mức Vận dụng: ${config.cognitiveLevels.application}%
`;
    return prompt;
}


const buildPromptForExamMatrix = (config: any): string => {
    const totalQuestions = getTotalQuestions(config.examStructure, config.questionCounts);
    const tfCount = config.questionCounts.trueFalse || 0;
    let prompt = buildBasePrompt(config);
    prompt += `
YÊU CẦU ĐẦU RA:
Hãy tạo ra dữ liệu cho **ma trận đề**. Trả về một đối tượng JSON duy nhất, không có giải thích hay markdown bao quanh. Cấu trúc JSON phải tuân thủ nghiêm ngặt schema đã được cung cấp và **chỉ chứa key 'matrix'**.

QUY TẮC QUAN TRỌNG:
1. Hàng "Tổng số câu" phải thể hiện chính xác tổng số câu là ${totalQuestions}.
2. Cột 'Tổng' cuối cùng phải là tổng của các cột 'Tổng' theo mức độ nhận thức (Tổng = Tổng Biết + Tổng Hiểu + Tổng Vận dụng).
3. Câu hỏi "Đúng/Sai":
   - Mỗi câu hỏi chính bao gồm 4 ý nhỏ (a, b, c, d).
   - Mỗi ý nhỏ (ví dụ: 1a, 1b) được tính là **một** mục riêng lẻ và phải được phân bổ vào ma trận.
   - Với ${tfCount} câu hỏi Đúng/Sai, bạn cần phân bổ chính xác tổng cộng ${tfCount * 4} ý nhỏ vào các ô \`tf_know\`, \`tf_comp\`, \`tf_app\`.
   - **QUY TẮC PHÂN BỔ BẮT BUỘC:**
     a. Tất cả 4 ý nhỏ của cùng một câu hỏi chính (ví dụ: các ý từ 1a đến 1d) PHẢI thuộc về CÙNG MỘT chủ đề (cùng một hàng trong ma trận).
     b. Các ý nhỏ của một câu (a, b, c, d) phải được phân bổ vào 3 mức độ nhận thức (Biết, Hiểu, Vận dụng). Điều này có nghĩa là một mức độ sẽ có 2 ý, và hai mức độ còn lại mỗi mức có 1 ý. Ví dụ: 2 ý ở mức Biết, 1 ý ở mức Hiểu, 1 ý ở mức Vận dụng.
     c. **TUYỆT ĐỐI KHÔNG** gộp tất cả 4 ý của một câu vào cùng một ô mức độ nhận thức (ví dụ: không được điền số 4 vào ô \`tf_know\`).
4. ĐỊNH DẠNG SỐ: Tất cả các giá trị số trong kết quả JSON phải là số nguyên (integer). TUYỆT ĐỐI không sử dụng số thập phân.
5. Hàng "Tỉ lệ %" và "Tỉ lệ điểm" phải có tổng là 100 và 10 tương ứng ở cột tổng cuối cùng.
`;
    return prompt;
};

const buildPromptForSpecificationMatrix = (config: any, matrix: MatrixData): string => {
    let prompt = buildBasePrompt(config);
    prompt += `
Dữ liệu Ma Trận Đề đã tạo (dùng làm ngữ cảnh):
${JSON.stringify(matrix, null, 2)}

YÊU CẦU ĐẦU RA:
Dựa vào thông tin cấu hình và ma trận đề đã có, hãy tạo ra dữ liệu cho **ma trận đặc tả**. Trả về một đối tượng JSON duy nhất, không có giải thích hay markdown bao quanh. Cấu trúc JSON phải tuân thủ nghiêm ngặt schema đã được cung cấp và **chỉ chứa key 'specification'**.

**QUY TẮC ĐỒNG BỘ BẮT BUỘC:**
1. Dữ liệu số lượng câu hỏi trong các chủ đề của \`specification\` (ví dụ: \`mcq_know\`, \`tf_comp\`, \`essay_app\`) PHẢI GIỐNG HỆT với dữ liệu tương ứng trong \`matrix.topicRows\` đã cung cấp. TUYỆT ĐỐI KHÔNG được thay đổi bất kỳ con số nào.
2. \`summaryRows\` của \`specification\` cũng phải phản ánh chính xác tổng số câu hỏi từ \`matrix.summaryRows\`.

QUY TẮC QUAN TRỌNG VỀ "YÊU CẦU CẦN ĐẠT" (REQUIREMENTS):
1. Đối với mỗi chủ đề, hãy điền vào trường \`requirements\`. Đây là một object chứa ba trường string: 'knowledge', 'comprehension', và 'application'.
2. Nội dung của mỗi trường phải là một mô tả **chi tiết và cụ thể** về Yêu cầu cần đạt tương ứng với mức độ nhận thức đó (Biết, Hiểu, Vận dụng) và phù hợp với nội dung của chủ đề.
3. **TUYỆT ĐỐI KHÔNG** sử dụng văn bản chung chung hoặc lặp lại tên chủ đề. Hãy tạo ra các yêu cầu có ý nghĩa sư phạm, phản ánh đúng những gì học sinh cần đạt được.
   - Ví dụ cho môn Sinh học, chủ đề "Quang hợp", mức "Biết": "Trình bày được khái niệm và phương trình tổng quát của quang hợp."
   - Ví dụ cho môn Sinh học, chủ đề "Quang hợp", mức "Hiểu": "Giải thích được vai trò của các yếu tố như ánh sáng, nồng độ CO2, và nước đối với quá trình quang hợp."
   - Ví dụ cho môn Sinh học, chủ đề "Quang hợp", mức "Vận dụng": "Vận dụng kiến thức về quang hợp để giải thích các biện pháp kĩ thuật nhằm tăng năng suất cây trồng (ví dụ: trồng cây trong nhà kính, bón phân hợp lý)."
4. Đối với phần Trả lời ngắn, yêu cầu cần đạt phải hướng đến việc tính toán, định lượng hoặc xác định con số cụ thể.

QUY TẮC QUAN TRỌNG VỀ SỐ THỨ TỰ CÂU HỎI:
1. Trong mỗi chủ đề, hãy điền vào trường \`questionNumbers\`. Đây là một object chứa bốn object con: 'mcq', 'tf', 'sa', và 'essay'. Mỗi object con này lại chứa ba trường string: 'knowledge', 'comprehension', và 'application', dùng để liệt kê số thứ tự của các câu hỏi cho đúng loại và đúng mức độ nhận thức.
   Ví dụ cấu trúc: "questionNumbers": { "mcq": { "knowledge": "1, 5", "comprehension": "6", "application": "7" }, "tf": { "knowledge": "1a, 1b", "comprehension": "2c", "application": "3d" } }
2. QUY TẮC ĐÁNH SỐ THEO PHẦN: Mỗi loại câu hỏi (Trắc nghiệm khách quan, Đúng/Sai, Trả lời ngắn, Tự luận) phải có một chuỗi số thứ tự RIÊNG BIỆT, bắt đầu lại từ 1 cho mỗi loại.
3. Số thứ tự phải là duy nhất BÊN TRONG mỗi loại câu hỏi.
4. Câu hỏi Trắc nghiệm khách quan: Đánh số tuần tự bắt đầu từ 1 (ví dụ: "1, 2, 3").
5. Câu hỏi Đúng/Sai:
   a. Mỗi câu hỏi chính được đánh số tuần tự bắt đầu từ 1. Các ý nhỏ được ký hiệu bằng a, b, c, d. Ví dụ: câu Đúng/Sai đầu tiên sẽ có các ý là "1a, 1b, 1c, 1d", câu thứ hai là "2a, 2b, 2c, 2d".
   b. Mỗi ý nhỏ (ví dụ: 1a) được coi là một mục riêng biệt về mặt phân loại mức độ nhận thức.
   c. QUAN TRỌNG: Tất cả các ý nhỏ thuộc cùng một câu hỏi chính (ví dụ: 1a, 1b, 1c, 1d) PHẢI được liệt kê trong cùng một chủ đề.
   d. Hãy liệt kê các số thứ tự này ("1a", "1b", etc.) vào đúng trường trong cấu trúc \`questionNumbers\`.
6. Câu hỏi Trả lời ngắn và Tự luận: Đánh số tuần tự bắt đầu từ 1 cho mỗi loại.
7. Định dạng trong các trường 'knowledge', 'comprehension', 'application' phải là một chuỗi văn bản, các số/mã câu hỏi được ngăn cách bởi dấu phẩy. Nếu không có câu hỏi nào, hãy trả về một chuỗi rỗng.
`;
    return prompt;
}


const buildPromptForExam = (config: any, matrices: MatricesData): string => {
    let prompt = `Bạn là một trợ lý chuyên gia trong việc tạo đề thi cho giáo viên tại Việt Nam.
Dựa vào các thông tin cấu hình ban đầu và dữ liệu ma trận đã được tạo sẵn sau đây, hãy tạo ra **đề thi hoàn chỉnh và đáp án**.

Thông tin cấu hình:
- Kì thi: ${config.examType}
- Cấp học: ${config.educationLevel}
- Môn: ${config.subject}
- Khối lớp: ${config.grade}
- Thời gian làm bài: ${config.time} phút

`;

    prompt += `
Dữ liệu ma trận và đặc tả đã tạo (DÙNG LÀM CƠ SỞ CHÍNH - SOURCE OF TRUTH):
${JSON.stringify(matrices, null, 2)}

YÊU CẦU ĐẦU RA:
Hãy trả về một đối tượng JSON duy nhất, không có giải thích hay markdown bao quanh. Cấu trúc JSON phải tuân thủ nghiêm ngặt schema đã được cung cấp và **chỉ chứa key 'exam'**.

QUY TẮC QUAN TRỌNG VỀ NỘI DUNG ĐỀ THI:
1. **BẮT BUỘC ĐỒNG BỘ VỚI MA TRẬN ĐẶC TẢ**: Bạn phải tạo đủ câu hỏi cho TẤT CẢ các phần có số lượng > 0 trong ma trận đặc tả.
   - Nếu ma trận có cột Tự luận > 0, BẮT BUỘC phải tạo câu hỏi Tự luận (dù cấu hình ban đầu có thể khác).
   - Nếu ma trận có cột Trả lời ngắn > 0, BẮT BUỘC phải tạo câu hỏi Trả lời ngắn.
2. Cấu trúc đề thi phải bao gồm các phần sau (nếu ma trận có dữ liệu):
   - Phần I: Trắc nghiệm khách quan (Type: "Trắc nghiệm khách quan")
   - Phần II: Trắc nghiệm Đúng/Sai (Type: "Đúng/Sai")
   - Phần III: Trắc nghiệm Trả lời ngắn (Type: "Trả lời ngắn")
   - Phần IV: Tự luận (Type: "Tự luận")
3. **QUAN TRỌNG VỀ THỨ TỰ**: Các câu hỏi trong mảng \`exam.questions\` phải được sắp xếp theo đúng thứ tự phần: Trắc nghiệm khách quan -> Đúng/Sai -> Trả lời ngắn -> Tự luận.
4. Loại câu hỏi ("type") phải CHÍNH XÁC là một trong các chuỗi sau: "Trắc nghiệm khách quan", "Đúng/Sai", "Trả lời ngắn", "Tự luận".
5. Đối với câu hỏi "Trắc nghiệm khách quan", câu hỏi phải có 4 lựa chọn (A, B, C, D) trong trường "options".
6. Đối với câu hỏi "Đúng/Sai":
   - Trường "question" là câu dẫn chung.
   - Trường "subQuestions" là mảng chứa ĐÚNG 4 phát biểu (a, b, c, d).
   - Trường "answer" liệt kê đáp án dạng: "a-Đúng, b-Sai, c-Đúng, d-Sai".
7. Đối với câu hỏi "Trả lời ngắn" (Phần III):
   - **MỤC TIÊU**: Kiểm tra năng lực tính toán, đếm số lượng, hoặc xác định số liệu cụ thể.
   - **TUYỆT ĐỐI CẤM**: KHÔNG tạo câu hỏi dạng "Mệnh đề này đúng hay sai? (Ghi 1 nếu đúng, 0 nếu sai)". Đây là dạng sai quy chế.
   - **NỘI DUNG**: Câu hỏi phải yêu cầu học sinh tìm ra một **SỐ TỰ NHIÊN** (hoặc số thập phân). Ví dụ: "Có bao nhiêu...", "Tính giá trị của biểu thức...", "Kết quả là...", "Năm nào...".
   - **ĐÁP ÁN**: Trường "answer" BẮT BUỘC phải là một số tự nhiên (ví dụ: "123", "45", "5"). Tối đa 3-4 chữ số.
8. Đối với câu hỏi "Tự luận":
   - Tạo câu hỏi và đáp án chi tiết, kèm thang điểm hoặc hướng dẫn chấm trong phần "explanation".

Hãy kiểm tra kỹ lại Ma trận đặc tả (phần 'specification') trước khi sinh ra JSON. Đừng bỏ sót phần "Tự luận" nếu ma trận yêu cầu.
`;
    return prompt;
}

// --- SCHEMAS ---
const matrixTopicRowSchema = {
    type: Type.OBJECT,
    properties: {
        id: { type: Type.INTEGER },
        topic: { type: Type.STRING },
        mcq_know: { type: Type.INTEGER, description: "Số câu Nhiều lựa chọn - Mức Biết" },
        mcq_comp: { type: Type.INTEGER, description: "Số câu Nhiều lựa chọn - Mức Hiểu" },
        mcq_app: { type: Type.INTEGER, description: "Số câu Nhiều lựa chọn - Mức Vận dụng" },
        tf_know: { type: Type.INTEGER, description: "Số câu Đúng/Sai - Mức Biết" },
        tf_comp: { type: Type.INTEGER, description: "Số câu Đúng/Sai - Mức Hiểu" },
        tf_app: { type: Type.INTEGER, description: "Số câu Đúng/Sai - Mức Vận dụng" },
        sa_know: { type: Type.INTEGER, description: "Số câu Trả lời ngắn - Mức Biết" },
        sa_comp: { type: Type.INTEGER, description: "Số câu Trả lời ngắn - Mức Hiểu" },
        sa_app: { type: Type.INTEGER, description: "Số câu Trả lời ngắn - Mức Vận dụng" },
        essay_know: { type: Type.INTEGER, description: "Số câu Tự luận - Mức Biết" },
        essay_comp: { type: Type.INTEGER, description: "Số câu Tự luận - Mức Hiểu" },
        essay_app: { type: Type.INTEGER, description: "Số câu Tự luận - Mức Vận dụng" },
        total_know: { type: Type.INTEGER, description: "Tổng số câu - Mức Biết" },
        total_comp: { type: Type.INTEGER, description: "Tổng số câu - Mức Hiểu" },
        total_app: { type: Type.INTEGER, description: "Tổng số câu - Mức Vận dụng" },
        total_sum: { type: Type.INTEGER, description: "Tổng số câu của chủ đề (Biết + Hiểu + Vận dụng)" },
    }
};

const matrixSummaryRowSchema = {
    type: Type.OBJECT,
    properties: {
        label: { type: Type.STRING, description: "Nhãn: 'Tổng số câu', 'Tổng số điểm', 'Tỉ lệ %'" },
        mcq_know: { type: Type.INTEGER }, mcq_comp: { type: Type.INTEGER }, mcq_app: { type: Type.INTEGER },
        tf_know: { type: Type.INTEGER }, tf_comp: { type: Type.INTEGER }, tf_app: { type: Type.INTEGER },
        sa_know: { type: Type.INTEGER }, sa_comp: { type: Type.INTEGER }, sa_app: { type: Type.INTEGER },
        essay_know: { type: Type.INTEGER }, essay_comp: { type: Type.INTEGER }, essay_app: { type: Type.INTEGER },
        total_know: { type: Type.INTEGER }, total_comp: { type: Type.INTEGER }, total_app: { type: Type.INTEGER },
        total_sum: { type: Type.INTEGER, description: "Giá trị cuối cùng của cột 'Tổng', ví dụ: 10 hoặc 100 hoặc tổng số câu" },
    }
};

const questionNumbersByLevelSchema = {
    type: Type.OBJECT,
    properties: {
        knowledge: { type: Type.STRING, description: "Số thứ tự câu hỏi mức Biết. VD: '1, 2'" },
        comprehension: { type: Type.STRING, description: "Số thứ tự câu hỏi mức Hiểu. VD: '3'" },
        application: { type: Type.STRING, description: "Số thứ tự câu hỏi mức Vận dụng. VD: '4'" },
    },
    required: ['knowledge', 'comprehension', 'application']
};

const specificationTopicSchema = {
    type: Type.OBJECT,
    properties: {
        id: { type: Type.INTEGER },
        content: { type: Type.STRING, description: "Nội dung hoặc đơn vị kiến thức" },
        questionNumbers: {
            type: Type.OBJECT,
            description: "Số thứ tự các câu hỏi, được phân loại theo loại câu hỏi và mức độ nhận thức.",
            properties: {
                mcq: questionNumbersByLevelSchema,
                tf: questionNumbersByLevelSchema,
                sa: questionNumbersByLevelSchema,
                essay: questionNumbersByLevelSchema,
            },
            required: ['mcq', 'tf', 'sa', 'essay']
        },
        requirements: {
            type: Type.OBJECT, properties: {
                knowledge: { type: Type.STRING, description: "Yêu cầu cần đạt cho mức Biết" },
                comprehension: { type: Type.STRING, description: "Yêu cầu cần đạt cho mức Hiểu" },
                application: { type: Type.STRING, description: "Yêu cầu cần đạt cho mức Vận dụng" },
            }
        },
        mcq_know: { type: Type.INTEGER }, mcq_comp: { type: Type.INTEGER }, mcq_app: { type: Type.INTEGER },
        tf_know: { type: Type.INTEGER }, tf_comp: { type: Type.INTEGER }, tf_app: { type: Type.INTEGER },
        sa_know: { type: Type.INTEGER }, sa_comp: { type: Type.INTEGER }, sa_app: { type: Type.INTEGER },
        essay_know: { type: Type.INTEGER }, essay_comp: { type: Type.INTEGER }, essay_app: { type: Type.INTEGER },
    }
};

const specificationSummaryRowSchema = {
    type: Type.OBJECT,
    properties: {
        label: { type: Type.STRING },
        mcq_know: { type: Type.INTEGER }, mcq_comp: { type: Type.INTEGER }, mcq_app: { type: Type.INTEGER },
        tf_know: { type: Type.INTEGER }, tf_comp: { type: Type.INTEGER }, tf_app: { type: Type.INTEGER },
        sa_know: { type: Type.INTEGER }, sa_comp: { type: Type.INTEGER }, sa_app: { type: Type.INTEGER },
        essay_know: { type: Type.INTEGER }, essay_comp: { type: Type.INTEGER }, essay_app: { type: Type.INTEGER },
    }
};

const examSchema = {
    type: Type.OBJECT,
    properties: {
        header: {
            type: Type.OBJECT, properties: {
                examType: { type: Type.STRING },
                subject: { type: Type.STRING },
                time: { type: Type.STRING }
            }
        },
        questions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT, properties: {
                    type: { type: Type.STRING, description: "Loại câu hỏi: 'Trắc nghiệm khách quan', 'Đúng/Sai', 'Trả lời ngắn', 'Tự luận'" },
                    level: { type: Type.STRING },
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Dành cho câu hỏi Nhiều lựa chọn (MCQ)." },
                    subQuestions: {
                        type: Type.ARRAY,
                        description: "Dành cho câu hỏi Đúng/Sai, mỗi phát biểu có mức độ riêng.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                text: { type: Type.STRING, description: "Nội dung của phát biểu." },
                                level: { type: Type.STRING, description: "Mức độ nhận thức (Biết, Hiểu, Vận dụng) của phát biểu." }
                            }
                        }
                    },
                    answer: { type: Type.STRING },
                    explanation: { type: Type.STRING, description: "Giải thích chi tiết cho đáp án." }
                }
            }
        }
    }
};

const examMatrixResponseSchema = {
    type: Type.OBJECT,
    properties: {
        matrix: {
            type: Type.OBJECT, description: "Dữ liệu chi tiết cho ma trận đề thi.",
            properties: {
                topicRows: { type: Type.ARRAY, items: matrixTopicRowSchema },
                summaryRows: { type: Type.ARRAY, items: matrixSummaryRowSchema }
            }
        }
    }
};

const specificationResponseSchema = {
    type: Type.OBJECT,
    properties: {
        specification: {
            type: Type.OBJECT, description: "Dữ liệu chi tiết cho ma trận đặc tả.",
            properties: {
                topics: { type: Type.ARRAY, items: specificationTopicSchema },
                summaryRows: { type: Type.ARRAY, items: specificationSummaryRowSchema }
            }
        },
    }
};

const fullExamResponseSchema = {
    type: Type.OBJECT,
    properties: {
        exam: examSchema
    }
};

export const generateExamMatrix = async (config: any): Promise<MatrixData> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = buildPromptForExamMatrix(config);
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: examMatrixResponseSchema,
                temperature: 0.7,
            },
        });
        
        const parsedData = cleanAndParseJson(response.text);
        
        if (!parsedData.matrix) {
            throw new Error("Invalid matrix data structure received from API.");
        }
        
        return parsedData.matrix as MatrixData;

    } catch (error) {
        console.error("Error calling Gemini API for exam matrix:", error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Không thể tạo dữ liệu ma trận đề. Vui lòng thử lại.");
    }
};

export const generateSpecificationMatrix = async (config: any, matrix: MatrixData): Promise<SpecificationData> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = buildPromptForSpecificationMatrix(config, matrix);
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: specificationResponseSchema,
                temperature: 0.7,
            },
        });
        
        const parsedData = cleanAndParseJson(response.text);
        
        if (!parsedData.specification) {
            throw new Error("Invalid specification data structure received from API.");
        }
        
        const generatedSpec = parsedData.specification as SpecificationData;

        // Force sync question counts from matrix to specification to ensure consistency.
        if (generatedSpec.topics.length === matrix.topicRows.length) {
            generatedSpec.topics.forEach((specTopic, index) => {
                const matrixRow = matrix.topicRows[index];

                if (specTopic.id === matrixRow.id) { // Simple check, assuming order is preserved
                    specTopic.mcq_know = matrixRow.mcq_know;
                    specTopic.mcq_comp = matrixRow.mcq_comp;
                    specTopic.mcq_app = matrixRow.mcq_app;
                    specTopic.tf_know = matrixRow.tf_know;
                    specTopic.tf_comp = matrixRow.tf_comp;
                    specTopic.tf_app = matrixRow.tf_app;
                    specTopic.sa_know = matrixRow.sa_know;
                    specTopic.sa_comp = matrixRow.sa_comp;
                    specTopic.sa_app = matrixRow.sa_app;
                    specTopic.essay_know = matrixRow.essay_know;
                    specTopic.essay_comp = matrixRow.essay_comp;
                    specTopic.essay_app = matrixRow.essay_app;
                }
            });
        }
        
        // Also sync the summary row for "Tổng số câu"
        const matrixTotalRow = matrix.summaryRows.find(row => row.label.includes('Tổng số câu'));
        const specTotalRow = generatedSpec.summaryRows.find(row => row.label.includes('Tổng số câu'));

        if (matrixTotalRow && specTotalRow) {
            specTotalRow.mcq_know = matrixTotalRow.mcq_know;
            specTotalRow.mcq_comp = matrixTotalRow.mcq_comp;
            specTotalRow.mcq_app = matrixTotalRow.mcq_app;
            specTotalRow.tf_know = matrixTotalRow.tf_know;
            specTotalRow.tf_comp = matrixTotalRow.tf_comp;
            specTotalRow.tf_app = matrixTotalRow.tf_app;
            specTotalRow.sa_know = matrixTotalRow.sa_know;
            specTotalRow.sa_comp = matrixTotalRow.sa_comp;
            specTotalRow.sa_app = matrixTotalRow.sa_app;
            specTotalRow.essay_know = matrixTotalRow.essay_know;
            specTotalRow.essay_comp = matrixTotalRow.essay_comp;
            specTotalRow.essay_app = matrixTotalRow.essay_app;
        }

        return generatedSpec;

    } catch (error) {
        console.error("Error calling Gemini API for specification matrix:", error);
         if (error instanceof Error) {
            throw error;
        }
        throw new Error("Không thể tạo dữ liệu ma trận đặc tả. Vui lòng thử lại.");
    }
};


export const generateFullExam = async (config: any, matrices: MatricesData): Promise<ExamData> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = buildPromptForExam(config, matrices);
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: fullExamResponseSchema,
                temperature: 0.8,
            },
        });
        
        const parsedData = cleanAndParseJson(response.text);

        if (!parsedData.exam || !parsedData.exam.questions) {
            throw new Error("Invalid exam data structure received from API.");
        }
        
        return parsedData.exam as ExamData;

    } catch (error) {
        console.error("Error calling Gemini API for full exam:", error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("Không thể tạo đề thi hoàn chỉnh. Vui lòng thử lại.");
    }
};

