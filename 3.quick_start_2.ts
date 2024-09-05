// Setting up the environment variables

const CONFIG = {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
}

if (!CONFIG.TAVILY_API_KEY || !CONFIG.ANTHROPIC_API_KEY) {
    console.error('Please provide Tavily and Anthropic API keys')
    process.exit(1)
}



import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { END, START, StateGraph, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Define the graph state
const GraphAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (state, update) => state.concat(update),
        default: () => [],
    })
})

// Define the tools for the agent to use
// const tools = [new TavilySearchResults({ maxResults: 3 })];

// Define the tools for the agent to use
const weatherTool = tool(async ({ query }) => {
    // This is a placeholder for the actual implementation
    if (query.toLowerCase().includes("sf") || query.toLowerCase().includes("san francisco")) {
      return "It's 60 degrees and foggy."
    }
    return "It's 90 degrees and sunny."
  }, {
    name: "weather",
    description:
      "Call to get the current weather for a location.",
    schema: z.object({
      query: z.string().describe("The query to use in your search."),
    }),
  });
  
  const tools = [weatherTool];

const toolNode = new ToolNode(tools);

// const model = new ChatOpenAI({ temperature: 0 }).bindTools(tools);
const model = new ChatAnthropic({
    model: "claude-3-5-sonnet-20240620",
    temperature: 0,
}).bindTools(tools);

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof GraphAnnotation.State): "tools" | typeof END {
    const messages = state.messages;

    const lastMessage = messages[messages.length - 1];

    // If the LLM makes a tool call, then we route to the "tools" node
    if (lastMessage.additional_kwargs.tool_calls) {
        return "tools";
    }
    // Otherwise, we stop (reply to the user)
    return END;
}

// Define the function that calls the model
async function callModel(state: typeof GraphAnnotation.State) {
    const messages = state.messages;

    const response = await model.invoke(messages);

    console.log("callModel response:", response);

    // We return a list, because this will get added to the existing list
    return { messages: [response] };
}

// Define a new graph
const workflow = new StateGraph(GraphAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

// Initialize memory to persist state between graph runs
const checkpointer = new MemorySaver();

// Finally, we compile it!
// This compiles it into a LangChain Runnable.
// Note that we're (optionally) passing the memory when compiling the graph
const app = workflow.compile({ checkpointer });

// Use the agent
const main = async () => {
    const finalState = await app.invoke(
        { messages: [new HumanMessage("what is the weather in sf")] },
        { configurable: { thread_id: "42" } },
    );

    console.log(finalState.messages[finalState.messages.length - 1].content);

    const nextState = await app.invoke(
        { messages: [new HumanMessage("what about ny")] },
        { configurable: { thread_id: "42" } },
    );

    console.log(nextState.messages[nextState.messages.length - 1].content);
}

main();