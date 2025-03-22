"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const redditCalls_1 = require("./redditCalls");
// Fetch and display hot posts from a subreddit
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const subreddit = "javascript";
        const posts = yield (0, redditCalls_1.fetchHotPosts)(subreddit);
        console.log(`🔥 Top 5 Hot Posts from r/${subreddit}:`);
        posts.forEach((post, index) => {
            console.log(`${index + 1}. ${post.title}`);
            console.log(`   🔗 ${post.url}`);
        });
    });
}
// Run the script
main();
