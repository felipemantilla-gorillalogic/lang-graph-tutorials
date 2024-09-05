// Setting up the environment variables

const CONFIG = {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
}

if (!CONFIG.TAVILY_API_KEY || !CONFIG.ANTHROPIC_API_KEY) {
    console.error('Please provide Tavily and Anthropic API keys')
    process.exit(1)
}


// AGENT 

import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";

// Define the tools for the agent to use
const agentTools = [new TavilySearchResults({ maxResults: 3 })];
const agentModel = new ChatAnthropic({
    model: "claude-3-5-sonnet-20240620",
    temperature: 0,
})

// Initialize memory to persist state between graph runs
const agentCheckpointer = new MemorySaver();
const agent = createReactAgent({
    llm: agentModel,
    tools: agentTools,
    checkpointSaver: agentCheckpointer,
});

// Now it's time to use!
const main = async () => {
    const agentFinalState = await agent.invoke(
        { messages: [new HumanMessage("what is the current weather in sf")] },
        { configurable: { thread_id: "42" } },
    );

    console.log(
        agentFinalState.messages[agentFinalState.messages.length - 1].content,
    );

    const agentNextState = await agent.invoke(
        { messages: [new HumanMessage("what about ny")] },
        { configurable: { thread_id: "42" } },
    );

    console.log(
        agentNextState.messages[agentNextState.messages.length - 1].content,
    );
}

main();