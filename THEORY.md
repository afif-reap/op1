
PRD: Semantic Code Graph Engine (MVP)
Version: 1.0
Scope: Single-Root Repository (No Monorepo logic)
Goal: Create a retrieval engine that understands code structure (AST) and relationships (Graph) to answer queries like "What happens if I change X?"
1. System Architecture
The system is composed of two main loops:
The Indexing Loop (Write Path): Converts raw text into a "Code Knowledge Graph."
The Retrieval Loop (Read Path): Traverses that graph to build the perfect context for an LLM.
Data Model (The Schema)
We need to treat code as Nodes (things) and Edges (relationships), not just text.
1. The Node (Code Chunk)
Every "Indexable Symbol" (Function, Class, Interface) becomes a node.

JSON


{
  "id": "UUID",
  "name": "calculateTax",
  "type": "FUNCTION", // or CLASS, METHOD
  "file_path": "src/utils/tax.ts",
  "content": "function calculateTax(a, b) { ... }", // Full text
  "embedding": [0.12, -0.98, ...] // Vector representation
}


2. The Edge (Relationship)
How nodes connect.

JSON


{
  "source_id": "UUID_A",
  "target_id": "UUID_B",
  "type": "CALLS" // or INHERITS, IMPORTS, DEFINES
}


2. The Indexing Pipeline (Pseudocode)
Objective: Scan the folder, understand what code exists (AST), and map how it connects (LSP/SCIP).
Algorithm: IndexRepository(root_path)

Plaintext


FUNCTION IndexRepository(root_path):
    1. INIT empty GraphDB and VectorDB
    2. files_list = GET all .ts/.js files in root_path

    // Step A: Generate the Relationship Map (The "GPS")
    // Use an external tool (like SCIP CLI) to get raw relationships
    scip_index = EXECUTE("scip-typescript index")
    relationship_map = PARSE_SCIP(scip_index) 

    // Step B: Process each file
    FOR EACH file IN files_list:
        
        // 1. Parse Structure (AST)
        // Don't read lines; read "Definitions"
        ast_tree = PARSE_AST(file.content)
        symbols = EXTRACT_NODES(ast_tree, types=["Function", "Class"])

        FOR EACH symbol IN symbols:
            // 2. Create the Node
            node = NEW Node()
            node.name = symbol.name
            node.content = symbol.body_text
            node.vector = GENERATE_EMBEDDING(symbol.body_text)
            
            // 3. Link to Graph (The crucial step)
            // Look up this symbol in the SCIP map to find what it touches
            outgoing_calls = LOOKUP_CALLS(relationship_map, symbol.position)
            
            // 4. Persist
            SAVE node TO VectorDB
            SAVE outgoing_calls AS edges TO GraphDB

    RETURN "Indexing Complete"


Key Logic: EXTRACT_NODES
We strictly avoid arbitrary chunking (e.g., "every 50 lines").

Plaintext


FUNCTION EXTRACT_NODES(ast_tree):
    chunks = []
    // Traverse the AST looking for specific types
    TRAVERSE ast_tree AS node:
        IF node.type IS "FunctionDeclaration":
            chunks.ADD({
                type: "FUNCTION",
                start: node.start_byte,
                end: node.end_byte,
                text: GET_TEXT(node) 
            })
        ELSE IF node.type IS "ClassDeclaration":
             // Capture class but maybe exclude methods (store them separately)
             chunks.ADD(...)
    RETURN chunks


3. The Retrieval Pipeline (Pseudocode)
Objective: When a user asks a question, find the direct answer, then "walk the graph" to find the context (what breaks, what depends on it).
Algorithm: SmartQuery(user_question)

Plaintext


FUNCTION SmartQuery(user_question):
    
    // Step 1: Vector Search (Find the "Needle")
    query_vector = GENERATE_EMBEDDING(user_question)
    seed_nodes = VECTOR_SEARCH(query_vector, limit=5)

    context_bundle = []

    // Step 2: Graph Expansion (Find the "Haystack")
    FOR EACH node IN seed_nodes:
        
        // A. Add the node itself
        context_bundle.ADD(node.content)

        // B. Find "Upstream" Context (Who calls me?)
        // Crucial for understanding impact of changes
        usages = GRAPH_DB.QUERY(
            "MATCH (caller)-[:CALLS]->(node) RETURN caller LIMIT 3"
        )
        context_bundle.ADD("Used by:", usages)

        // C. Find "Downstream" Context (What do I depend on?)
        // Crucial for understanding how the function works
        dependencies = GRAPH_DB.QUERY(
            "MATCH (node)-[:CALLS]->(dependency) RETURN dependency LIMIT 3"
        )
        context_bundle.ADD("Depends on:", dependencies)

    // Step 3: Synthesis
    prompt = BUILD_PROMPT(user_question, context_bundle)
    response = LLM.GENERATE(prompt)

    RETURN response


4. Technical Specifications
4.1 Required Components
Parser: Must support Tree-sitter. It is the industry standard for fast, error-tolerant parsing.
LSIF/SCIP Generator: Do not write your own static analyzer. Use off-the-shelf indexers (e.g., scip-typescript, scip-python) to generate the raw relationship data.
Vector Database: Any database that supports vector similarity (pgvector, Qdrant, Chroma).
Graph Database (Optional for MVP):
Lite approach: Use a simple SQL table Edges (source, target, type) and use recursive queries.
Pro approach: Use Neo4j or Memgraph.
4.2 Handling Updates (The "Freshness" Problem)
To avoid re-indexing the whole repo on every save:

Plaintext


FUNCTION OnFileSave(file_path):
    1. DELETE all Nodes/Edges where file_path == file_path
    2. RE-RUN IndexRepository for ONLY that one file
    3. (Advanced) RE-CALCULATE edges for files that import this file


5. Implementation Roadmap
Phase 1: "The Librarian" (Read-Only)
Implement IndexRepository simply reading files and chunking by AST.
Skip the Graph/SCIP part.
Just perform Vector Search.
Result: Better than standard RAG because chunks are whole functions, not random lines.
Phase 2: "The Detective" (Graph Connected)
Integrate SCIP CLI to generate index.scip.
Parse index.scip to build the Edge table.
Update SmartQuery to fetch "Callers" and "Callees".
Result: The AI can tell you "If you update Login(), you might break AuthMiddleware."
Phase 3: "The Architect" (Full Augment Clone)
Add streaming updates (file watchers).
Add "Branch Awareness" (indexing different git branches separately).
