#!/usr/bin/env node

import axios from "axios";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Environment validation
const requiredEnvVars = ["IMGFLIP_USERNAME", "IMGFLIP_PASSWORD"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: ${envVar} environment variable is required`);
    process.exit(1);
  }
}

// Constants
const IMGFLIP_API_URL = "https://api.imgflip.com/caption_image";
const SERVER_VERSION = "1.0.1";

// Create an MCP server
const server = new McpServer({
  name: "Meme Image Server",
  version: SERVER_VERSION,
});

// Register the generateMeme tool
server.tool(
  "generateMeme",
  "Generate a meme image from Imgflip using the numeric template id and text",
  {
    templateNumericId: z.string().describe("The numeric ID of the meme template to use"),
    text0: z.string().describe("The text for the first placeholder"),
    text1: z.string().optional().describe("The text for the second placeholder"),
  },
  async ({
    templateNumericId,
    text0,
    text1,
  }: {
    templateNumericId: string;
    text0: string;
    text1?: string;
  }) => {
    try {
      // Validate inputs
      if (!templateNumericId.trim()) {
        throw new Error("Template ID cannot be empty");
      }
      if (!text0.trim()) {
        throw new Error("Text0 cannot be empty");
      }

      // Prepare the Imgflip API request
      const formData = new FormData();
      formData.append("template_id", templateNumericId);
      formData.append("text0", text0);
      if (text1) formData.append("text1", text1);
      formData.append("username", process.env.IMGFLIP_USERNAME || "");
      formData.append("password", process.env.IMGFLIP_PASSWORD || "");

      // Send the request to the Imgflip API
      const response = await axios.post(IMGFLIP_API_URL, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 30000, // 30 second timeout
      });

      // Check if the API request was successful
      if (!response.data.success) {
        throw new Error(`Imgflip API error: ${response.data.error_message || "Unknown error"}`);
      }

      // Get the image URL from the response
      const imageUrl = response.data.data.url;
      if (!imageUrl) {
        throw new Error("No image URL returned from Imgflip API");
      }

      // Download the image
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000, // 30 second timeout
      });
      const imageDataBase64 = Buffer.from(imageResponse.data).toString("base64");

      // Return the image as a base64 encoded string
      return {
        content: [{ type: "image", data: imageDataBase64, mimeType: "image/jpeg" }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("Meme generation failed:", errorMessage);

      // Return an error message
      return {
        content: [
          {
            type: "text",
            text: `Failed to generate meme: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Register the getMemeTemplates tool
server.tool(
  "getMemeTemplates",
  "Get a list of popular meme templates from Imgflip",
  {},
  async () => {
    try {
      const response = await axios.get("https://api.imgflip.com/get_memes", {
        timeout: 30000,
      });

      if (!response.data.success) {
        throw new Error(`Imgflip API error: ${response.data.error_message || "Unknown error"}`);
      }

      const memes = response.data.data.memes.slice(0, 20); // Get top 20 popular templates
      const memeList = memes.map((meme: any) => ({
        id: meme.id,
        name: meme.name,
        box_count: meme.box_count,
        url: meme.url,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Available meme templates:\n\n${memeList
              .map(
                (meme: { id: string; name: string; box_count: number }) =>
                  `ID: ${meme.id} - Name: ${meme.name} (${meme.box_count} text boxes)`
              )
              .join("\n")}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("Failed to fetch meme templates:", errorMessage);

      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch meme templates: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
