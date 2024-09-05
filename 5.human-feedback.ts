const CONFIG = {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    TOGETHER_AI_API_KEY: process.env.TOGETHER_AI_API_KEY,
}


import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
    input: Annotation,
    userFeedback: Annotation
});

const step1 = (state: typeof StateAnnotation.State) => {
    console.log("---Step 1---");
    return state;
}

const humanFeedback = (state: typeof StateAnnotation.State) => {
    console.log("--- humanFeedback ---");
    return state;
}

const step3 = (state: typeof StateAnnotation.State) => {
    console.log("---Step 3---");
    return state;
}

const builder = new StateGraph(StateAnnotation)
    .addNode("step1", step1)
    .addNode("humanFeedback", humanFeedback)
    .addNode("step3", step3)
    .addEdge(START, "step1")
    .addEdge("step1", "humanFeedback")
    .addEdge("humanFeedback", "step3")
    .addEdge("step3", END);


// Set up memory
const memory = new MemorySaver()

// Add 
const graph = builder.compile({
    checkpointer: memory,
    interruptBefore: ["humanFeedback"]
});


// Input
const initialInput = { input: "hello world" };

// Thread
const config = { configurable: { thread_id: "1" }, streamMode: "values" as const };


const main = async () => {
    // Run the graph until the first interruption
    for await (const event of await graph.stream(initialInput, config)) {
        console.log(`--- ${event.input} ---`);
    }

    // Will log when the graph is interrupted, after step 2.
    console.log("--- GRAPH INTERRUPTED ---");


    /** ----------------------------------------------------------------------
     * UPDATING STATE BY USING HUMAN FEEDBACK
     * ----------------------------------------------------------------------
     */

    // You should replace this with actual user input from a source, e.g stdin
    const userInput = "Go to step 3!!";

    // We now update the state as if we are the humanFeedback node
    await graph.updateState(config, { "userFeedback": userInput, asNode: "humanFeedback" });

    // We can check the state
    console.log("--- State after update ---")
    console.log(await graph.getState(config));

    // We can check the next node, showing that it is node 3 (which follows human_feedback)
    console.log((await graph.getState(config)).next)

    for await (const event of await graph.stream(null, config)) {
        console.log(`--- ${event.input} ---`);
    }

    console.log((await graph.getState(config)).values);
}

main();