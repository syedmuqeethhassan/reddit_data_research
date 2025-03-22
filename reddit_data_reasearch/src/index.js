import { searchSubreddit, fetchPostComments } from "./redditCalls.js";
import fs from 'fs/promises';
import { sendFile } from './sendToBackend.js';

// Function to save data to a file
async function saveDataToFile(data, filename) {
    try {
        // Create a directory for output if it doesn't exist
        await fs.mkdir('./output', { recursive: true });
        
        // Write the data to a JSON file
        await fs.writeFile(`./output/${filename}`, JSON.stringify(data, null, 2));
        console.log(`✅ Data successfully saved to ./output/${filename}`);
    } catch (error) {
        console.error(`❌ Error saving data to file:`, error);
    }
}

// Main function to fetch posts and their comments
async function main() {
    const keyword = "lexus ls430"; // Change keyword as needed
    const subreddit = "whatcarshouldibuy"; // Specific subreddit to search
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilename = `result.json`;
    
    console.log(`Searching r/${subreddit} for "${keyword}"...`);

    const posts = await searchSubreddit(keyword, subreddit, 10, "relevance"); // Search for 10 posts

    if (posts.length === 0) {
        console.log(`No posts found in r/${subreddit} matching "${keyword}".`);
        return;
    }

    console.log(`\nFound ${posts.length} posts in r/${subreddit} matching "${keyword}"\n`);
    
    // Create a data structure to hold all posts and comments
    const allData = {
        keyword,
        subreddit,
        fetchDate: new Date().toISOString(),
        posts: []
    };
    
    // Process each post
    for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const postData = { ...post };

        console.log(`\nPOST ${i + 1}: ${post.title}`);
        console.log(`URL: ${post.url}`);
        console.log(`Author: ${post.author} | Score: ${post.score} | Comments: ${post.num_comments}`);
        console.log(`Posted: ${new Date(post.created).toLocaleString()}`);
        
        // Show truncated post content if available
        if (post.selftext && post.selftext !== "[No content]") {
            const preview = post.selftext.length > 150 
                ? post.selftext.substring(0, 150) + "..." 
                : post.selftext;
            console.log(`Content: ${preview}`);
        }

        if (!post.id) {
            console.error(`❌ Skipping post ${i + 1} - ID is undefined`);
            continue;
        }

        // Fetch comments with improved function
        console.log(`Fetching comments...`);
        const comments = await fetchPostComments(post.id, 15, 3);
        
        console.log(`Fetched ${comments.length} comments with nested replies`);
        
        // Add comments to the post data
        postData.comments = comments;
        allData.posts.push(postData);

        // Display sample comments with improved formatting
        if (comments.length > 0) {
            console.log("\nTOP COMMENTS:");
            comments.slice(0, 5).forEach((comment, idx) => {
                console.log("\n" + "-".repeat(40)); // Separator for readability
                
                // Display comment with proper formatting
                console.log(`COMMENT ${idx + 1}:`);
                console.log(`Author: ${comment.author} | Score: ${comment.score}`);
                console.log(`${comment.text}`);
                
                if (comment.replies.length > 0) {
                    console.log(`\nReplies (${comment.replies.length}):`);
                    
                    // Show top 2 replies if available
                    comment.replies.slice(0, 2).forEach((reply, replyIdx) => {
                        console.log(`\n  Reply ${replyIdx + 1}:`);
                        console.log(`  Author: ${reply.author} | Score: ${reply.score}`);
                        console.log(`  ${reply.text}`);
                    });
                    
                    // Indicate if there are more replies
                    if (comment.replies.length > 2) {
                        console.log(`\n  ... and ${comment.replies.length - 2} more replies`);
                    }
                } else {
                    console.log("\nNo replies to this comment");
                }
            });
        }

        console.log("\n" + "=".repeat(60)); // Post separator
    }
    
    // Save all data to a file
    await saveDataToFile(allData, outputFilename);
    sendFile();
 
    
    console.log(`\nSearch complete for "${keyword}" in r/${subreddit}.`);
    console.log(`Data has been saved to ./output/${outputFilename}`);
}

// Run the script
main().catch(error => {
    console.error("Error in main function:", error);
    process.exit(1);
});