
import fs from 'fs/promises';
import path from 'path';
import http from 'http';

export async function sendFile() {
    try {
        // Check if the output directory exists
        const outputDir = './output';
        await fs.access(outputDir);
        
        // Read the result.json file
        const filePath = path.join(outputDir, 'result.json');
        const fileContent = await fs.readFile(filePath, 'utf8');
        
        console.log('Sending collected data to the chatbot for knowledge base initialization...');
        
        // Prepare the data to send
        const postData = JSON.stringify({ text: fileContent });
        
        // Send the file content to initialize the knowledge base using http module
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: '/initialize',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        return new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const data = JSON.parse(responseData);
                        if (data.success) {
                            console.log('✅ Knowledge base initialized successfully!');
                            console.log('✅ CLI chat is now active in the Python terminal window.');
                            console.log('   Switch to the Python terminal to start chatting!');
                            resolve(data);
                        } else {
                            console.error('❌ Error initializing knowledge base:', data.error);
                            reject(new Error(data.error));
                        }
                    } catch (error) {
                        console.error('❌ Error parsing response:', error.message);
                        reject(error);
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error('❌ Error sending file to backend:', error.message);
                reject(error);
            });
            
            // Write data to request body
            req.write(postData);
            req.end();
        });
    } catch (error) {
        console.error('❌ Error sending file to backend:', error.message);
    }
}



// import FormData from 'form-data';
// import fs from 'fs';
// import axios from 'axios';

// export async function sendFile() {
//     const filePath = './output/result.json';
//     const formData = new FormData();

//     // Append the file
//     formData.append('file', fs.createReadStream(filePath));

//     try {
//         const response = await axios.post('http://localhost:5000/test', formData, {
//             headers: {
//                 ...formData.getHeaders(), // ✅ Sets correct `Content-Type`
//             }
//         });

//         console.log("File sent successfully:", response.data);
//     } catch (error) {
//         console.error("Error sending file:", error.response ? error.response.data : error.message);
//     }
// }


