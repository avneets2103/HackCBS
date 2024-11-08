import os
from dotenv import load_dotenv
from app import app
from pinecone import Pinecone, ServerlessSpec

# Load environment variables from .env
load_dotenv()

def connect_db_and_start_server():
    try:
        # Set up Pinecone connection
        pinecone_api_key = os.getenv("PINECONE_API_KEY")
        pc = Pinecone(api_key=pinecone_api_key)

        # Check if index exists; create if necessary
        index_name = os.getenv("PINECONE_INDEX_NAME")
        if index_name not in pc.list_indexes().names():
            pc.create_index(
                name=index_name,
                dimension=768, 
                metric='cosine', 
                spec=ServerlessSpec(
                    cloud='aws',  
                    region='us-east-1',
                ),
            )
        print(f"Connected to Pinecone; index '{index_name}' is ready.")

        # Start Flask app
        port = os.getenv("PORT") or 8000  # Fallback to 8000 if PORT isn't set
        print(f"Server listening on port {port}")
        app.run(debug=True, port=int(port))
    
    except Exception as err:
        print("App didn't launch!", err)

if __name__ == "__main__":
    connect_db_and_start_server()
