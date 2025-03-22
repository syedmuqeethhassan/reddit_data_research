from flask import Flask, request, jsonify
import os
from openai import OpenAI
import google.generativeai as genai
from datetime import datetime
import json
import sys
import threading
import time
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.text_splitter import CharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferMemory
import unicodedata


# def clean_text_for_encoding(text):
#     if not isinstance(text, str):
#         return text
    
#     # Replace characters that might cause encoding issues with '?'
#     cleaned_text = ''
#     for char in text:
#         try:
#             # Try to encode the character with the system's default encoding
#             char.encode('ascii')
#             cleaned_text += char
#         except UnicodeEncodeError:
#             cleaned_text += '?'
    
#     return cleaned_text



# class SafeConversationBufferMemory(ConversationBufferMemory):
#     def save_context(self, inputs, outputs):
#         # Clean the inputs and outputs before saving
#         clean_inputs = {k: clean_text_for_encoding(v) for k, v in inputs.items()}
#         clean_outputs = clean_text_for_encoding(outputs)
        
#         super().save_context(clean_inputs, clean_outputs)




#--------------------------------------------------------------------------

app = Flask(__name__)

GOOGLE_API_KEY = "AIzaSyDHnpvA7mVU3x-Zf36YdP_xZr9QwVT10dQ"
genai.configure(api_key=GOOGLE_API_KEY)

# Initialize global variables
vector_store = None
conversation_chain = None
chat_history = []
cli_mode_active = False
initial_summary = None  # Added: To store the initial summary of the document


def generate_initial_summary(text_content):
    """Generate an initial summary or analysis of the uploaded content"""
    try:
        # Initialize Gemini model for summary generation
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        # Create prompt for initial summary
        summary_prompt = (
            "Please provide a comprehensive summary of the following text. "
            "Identify key points, main topics, and important information. "
            "This will be the first response to the user before they start chatting.\n\n"
            f"TEXT CONTENT:\n{text_content[:15000]}"  # Limit to first 15000 chars for large files
        )
        
        # Generate summary
        response = model.generate_content(summary_prompt)
        
        return response.text
    except Exception as e:
        print(f"Error generating initial summary: {str(e)}")
        return f"I've processed your document and I'm ready to chat about it. (Note: Initial summary generation encountered an error: {str(e)})"


def initialize_knowledge_base(text_content):
    """Initialize the knowledge base with the provided text content"""
    global vector_store, conversation_chain, initial_summary

    # Ensure text_content is cleaned before further processing
    if not isinstance(text_content, str):
        return text_content  # Return as is if not a string

    # Replace unencodable characters with '?'
    text_content = text_content.encode("utf-8", errors="replace").decode("utf-8")
    
    # Added: Generate initial summary first
    initial_summary = generate_initial_summary(text_content)
    
    # Split the text into chunks
    text_splitter = CharacterTextSplitter(
        separator="\n",
        chunk_size=5000,
        chunk_overlap=200,
        length_function=len
    )
    chunks = text_splitter.split_text(text_content)  # Use text_content instead of 'text'
    
    # Create embeddings and vector store
    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001", google_api_key=GOOGLE_API_KEY)
    vector_store = FAISS.from_texts(chunks, embeddings)
    
    # Create a conversation memory
    memory = ConversationBufferMemory(
        memory_key="chat_history",
        return_messages=True
    )
    
    # Create the conversation chain
    llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=GOOGLE_API_KEY)
    conversation_chain = ConversationalRetrievalChain.from_llm(
        llm=llm,
        retriever=vector_store.as_retriever(),
        memory=memory
    )
    
    return "Knowledge base initialized successfully"


@app.route('/initialize', methods=['POST'])
def initialize():
    """Initialize the knowledge base with uploaded file"""
    try:
        global cli_mode_active, initial_summary
        
        # Check if the request contains a file
        if 'file' in request.files:
            file = request.files['file']
            text_content = file.read().decode('utf-8', errors='replace')
            print("Received file content for initialization")
        else:
            # If no file, try to get JSON data
            data = request.get_json()
            if data and 'text' in data:
                text_content = data['text']
                print("Received JSON data for initialization")
            else:
                # If no file or JSON, check form data
                text_content = request.form.get('text', '')
                if not text_content:
                    return jsonify({"error": "No data provided"}), 400
                print("Received form data for initialization")
        
        # Initialize the knowledge base
        result = initialize_knowledge_base(text_content)
        
        # Save the file for future reference
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        os.makedirs('./knowledge_base', exist_ok=True)
        with open(f'./knowledge_base/kb_{timestamp}.txt', 'w', encoding='utf-8', errors='replace') as f:
            f.write(text_content)
        
        # Start CLI mode in a separate thread
        if not cli_mode_active:
            cli_mode_active = True
            threading.Thread(target=start_cli_mode).start()
        
        # Added: Include initial summary in the response
        return jsonify({
            "success": True,
            "message": result,
            "saved_to": f'./knowledge_base/kb_{timestamp}.txt',
            "initial_summary": initial_summary  # Return the initial summary
        })
        
    except Exception as e:
        print(f"Error initializing knowledge base: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# Added: New endpoint to get initial summary if needed
@app.route('/get_initial_summary', methods=['GET'])
def get_initial_summary():
    """Return the initial summary of the uploaded document"""
    global initial_summary
    
    if initial_summary is None:
        return jsonify({
            "success": False,
            "error": "No document has been processed yet. Please upload a file first."
        }), 400
    
    return jsonify({
        "success": True,
        "initial_summary": initial_summary
    })


@app.route('/chat', methods=['POST'])
def chat():
    """Process chat messages"""
    try:
        global conversation_chain, chat_history
        
        # Check if knowledge base is initialized
        if conversation_chain is None:
            return jsonify({
                "success": False,
                "error": "Knowledge base not initialized. Please upload a file first."
            }), 400
        
        # Get the message from the request
        data = request.get_json()
        if not data or 'message' not in data:
            return jsonify({
                "success": False,
                "error": "No message provided"
            }), 400
        
        user_message = data['message']
        
        # Process the message with the conversation chain
        response = conversation_chain.invoke({
            "question": user_message,
            "chat_history": chat_history
        })
        
        # Extract the answer
        ai_message = response["answer"]
        
        # Update chat history
        chat_history.append(HumanMessage(content=user_message))
        chat_history.append(AIMessage(content=ai_message))
        
        # Save chat history
        os.makedirs('./chat_logs', exist_ok=True)
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        
        # Create result directory if it doesn't exist
        with open(f'./chat_logs/chat_{timestamp}.json', 'w') as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "user_message": user_message,
                "ai_response": ai_message
            }, f, indent=2)
        
        return jsonify({
            "success": True,
            "response": ai_message
        })
        
    except Exception as e:
        print(f"Error processing chat: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/test', methods=['POST'])
def process_with_gemini():
    """Original Gemini processing endpoint (kept for backward compatibility)"""
    try:
        # Check if the request contains a file
        if 'file' in request.files:
            file = request.files['file']
            text_content = file.read().decode('utf-8', errors="replace")  # Read file contents as a string
            print("Received file content")
            
            # Initialize knowledge base with the file
            initialize_knowledge_base(text_content)
        else:
            # If no file, try to get JSON data
            data = request.get_json()
            if data:
                text_content = json.dumps(data)  # Convert JSON to string
                print("Received JSON data")
            else:
                # If no file or JSON, check form data
                text_content = request.form.get('text', '')
                if not text_content:
                    return jsonify({"error": "No data provided"}), 400
                print("Received form data")
        
        # Get custom prompt from request or use default
        # Try to get prompt from form data, query parameters, or JSON body
        prompt = request.form.get('prompt') or request.args.get('prompt')
        
        # If prompt wasn't in form data or query params, check JSON body
        if not prompt and request.is_json:
            prompt = request.get_json().get('prompt')
        
        # If still no prompt, use default
        if not prompt:
            prompt = "what should i keep in mind before buying this vehicle used"
        
        print(f"Using prompt: {prompt}")
            
        # Initialize Gemini model
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        # Create full prompt by combining custom prompt and text content
        full_prompt = f"{prompt}\n\nTEXT CONTENT:\n{text_content}"
        
        # Generate response from Gemini
        response = model.generate_content(full_prompt)
        
        # Create result directory if it doesn't exist
        os.makedirs('./gemini_results', exist_ok=True)
        
        # Save results to file with timestamp
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        result_file = f"gemini_analysis_{timestamp}.json"
        result_path = os.path.join('./gemini_results', result_file)
        
        # Prepare response data
        result_data = {
            "timestamp": datetime.now().isoformat(),
            "prompt": prompt,
            "analysis": response.text,
            "model": "gemini-flash-2.0"
        }
        
        # Save result to file
        with open(result_path, 'w') as f:
            json.dump(result_data, f, indent=2)
        
        # Return response
        return jsonify({
            "success": True,
            "gemini_response": response.text,
            "saved_to": result_path
        })
        
    except Exception as e:
        print(f"Error processing request: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

def process_cli_message(message):
    """Process a message from the CLI"""
    global conversation_chain, chat_history
    
    try:
        # Process the message with the conversation chain
        response = conversation_chain.invoke({
            "question": message,
            "chat_history": chat_history
        })
        
        # Extract the answer
        ai_message = response["answer"]
        
        # Update chat history
        chat_history.append(HumanMessage(content=message))
        chat_history.append(AIMessage(content=ai_message))
        
        # Save chat history
        os.makedirs('./chat_logs', exist_ok=True)
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        
        with open(f'./chat_logs/chat_{timestamp}.json', 'w') as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "user_message": message,
                "ai_response": ai_message
            }, f, indent=2)
        
        return ai_message
    
    except Exception as e:
        return f"Error: {str(e)}"

def start_cli_mode():
    """Start the CLI mode for interacting with the chatbot"""
    global initial_summary  # Added: Access to initial_summary
    
    print("\n" + "="*50)
    print("🤖 CLI CHATBOT MODE ACTIVATED 🤖")
    print("="*50)
    print("Knowledge base initialized. You can now chat with the bot.")
    print("Type 'exit' or 'quit' to exit the chat.")
    print("="*50 + "\n")
    
    # Added: Display initial summary before starting the chat
    if initial_summary:
        print("\n🤖 Bot [Initial Document Summary]: ")
        print(initial_summary)
        print("\n" + "-"*50 + "\n")
    
    while True:
        try:
            # Get user input
            user_input = input("\n👤 You: ").strip()
            
            # Check if user wants to exit
            if user_input.lower() in ['exit', 'quit']:
                print("\nExiting chat mode. The server will continue running.")
                print("="*50)
                break
            
            # Process the message
            if conversation_chain is not None:
                print("\n🤖 Bot: ", end="")
                response = process_cli_message(user_input)
                print(response)
            else:
                print("\n🤖 Bot: Knowledge base not initialized. Please wait or restart the application.")
        
        except KeyboardInterrupt:
            print("\n\nExiting chat mode. The server will continue running.")
            print("="*50)
            break
        except Exception as e:
            print(f"\n🤖 Bot: Error: {str(e)}")

if __name__ == '__main__':
    print("Starting Flask server with Langchain CLI Chatbot integration...")
    print("Listening on http://localhost:5000")
    
    # Start the Flask app in a separate thread
    threading.Thread(target=app.run, kwargs={'debug': False, 'port': 5000}).start()
    
    # Add a small delay to ensure the server starts before any CLI commands
    time.sleep(1)
    
    print("\nServer is running. Waiting for knowledge base initialization...")
    print("After initialization, you can chat with the bot directly in this terminal.")

#-------------------------------------------------------------------------------

# from flask import Flask, request, jsonify
# import os
# from openai import OpenAI
# import google.generativeai as genai
# import os
# from datetime import datetime
# import json


# app = Flask(__name__)

# GOOGLE_API_KEY = "AIzaSyDHnpvA7mVU3x-Zf36YdP_xZr9QwVT10dQ"
# genai.configure(api_key=GOOGLE_API_KEY)

# @app.route('/test', methods=['POST'])
# def process_with_gemini():
#     try:
#         # Check if the request contains a file
#         if 'file' in request.files:
#             file = request.files['file']
#             text_content = file.read().decode('utf-8')  # Read file contents as a string
#             print("Received file content")
#         else:
#             # If no file, try to get JSON data
#             data = request.get_json()
#             if data:
#                 text_content = json.dumps(data)  # Convert JSON to string
#                 print("Received JSON data")
#             else:
#                 # If no file or JSON, check form data
#                 text_content = request.form.get('text', '')
#                 if not text_content:
#                     return jsonify({"error": "No data provided"}), 400
#                 print("Received form data")
        
#         # Get custom prompt from request or use default
#         # Try to get prompt from form data, query parameters, or JSON body
#         prompt = request.form.get('prompt') or request.args.get('prompt')
        
#         # If prompt wasn't in form data or query params, check JSON body
#         if not prompt and request.is_json:
#             prompt = request.get_json().get('prompt')
        
#         # If still no prompt, use default
#         if not prompt:
#             prompt = "what should i keep in mind before buying this vehicle used"
        
#         print(f"Using prompt: {prompt}")
            
#         # Initialize Gemini model
        
        
#         # Create full prompt by combining custom prompt and text content
#         full_prompt = f"{prompt}\n\nTEXT CONTENT:\n{text_content}"
        
#         # Generate response from Gemini
#         response = model.generate_content(full_prompt)
        
#         # Create result directory if it doesn't exist
#         os.makedirs('./gemini_results', exist_ok=True)
        
#         # Save results to file with timestamp
#         timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
#         result_file = f"gemini_analysis_{timestamp}.json"
#         result_path = os.path.join('./gemini_results', result_file)
        
#         # Prepare response data
#         result_data = {
#             "timestamp": datetime.now().isoformat(),
#             "prompt": prompt,
#             "analysis": response.text,
#             "model": "gemini-flash-2.0"
#         }
        
#         # Save result to file
#         with open(result_path, 'w') as f:
#             json.dump(result_data, f, indent=2)
        
#         # Return response
#         return jsonify({
#             "success": True,
#             "gemini_response": response.text,
#             "saved_to": result_path
#         })
        
#     except Exception as e:
#         print(f"Error processing request: {str(e)}")
#         return jsonify({
#             "success": False,
#             "error": str(e)
#         }), 500

# if __name__ == '__main__':
#     print("Starting Flask server with Gemini Flash 2.0 integration...")
#     print("Listening on http://localhost:5000/test")
#     app.run(debug=True, port=5000)





























