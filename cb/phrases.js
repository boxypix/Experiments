// Редактируй фразы здесь.
// category: "Threads" | "Instagram" | "LinkedIn"
// Не удаляй "All" из categories — это вкладка «все фразы».

var DATA = {
  categories: ["All", "Threads", "Instagram", "LinkedIn"],
  phrases: [

    // =========================
    // THREADS
    // =========================

    // Praise
    { category: "Threads", text: "Love this take" },
    { category: "Threads", text: "Really like how you explained this" },
    { category: "Threads", text: "This is such a good point" },
    { category: "Threads", text: "You put this into words perfectly" },
    { category: "Threads", text: "This deserves way more attention" },
    { category: "Threads", text: "I enjoyed reading this from start to finish" },
    { category: "Threads", text: "This is one of the better posts I've seen today" },
    { category: "Threads", text: "Really appreciate you sharing this" },

    // Agree
    { category: "Threads", text: "Couldn't agree more" },
    { category: "Threads", text: "I'm with you on this" },
    { category: "Threads", text: "I've been thinking the same thing lately" },
    { category: "Threads", text: "This matches my experience too" },
    { category: "Threads", text: "Exactly how I see it" },
    { category: "Threads", text: "You summed it up really well" },
    { category: "Threads", text: "That's exactly what I wanted to say" },
    { category: "Threads", text: "Hard to disagree with any of this" },

    // Sympathy
    { category: "Threads", text: "Sorry you're dealing with that" },
    { category: "Threads", text: "That sounds really frustrating" },
    { category: "Threads", text: "Hope things get easier soon" },
    { category: "Threads", text: "Wishing you the best with everything" },
    { category: "Threads", text: "That can't have been easy" },
    { category: "Threads", text: "Really hope things work out for you" },

    // Admiration
    { category: "Threads", text: "This is seriously impressive" },
    { category: "Threads", text: "You've done an amazing job here" },
    { category: "Threads", text: "That's a fantastic result" },
    { category: "Threads", text: "Really impressed by what you've built" },
    { category: "Threads", text: "You should be proud of this" },
    { category: "Threads", text: "It's always inspiring to see work like this" },
    
    //Extra
    { category: "Threads", text: "I don't usually stop to comment but this was absolutely worth reading" },
    { category: "Threads", text: "You explained something I've been trying to put into words for a long time" },
    { category: "Threads", text: "This is one of those posts that makes you stop and think for a minute" },
    { category: "Threads", text: "There's a lot of value packed into such a short post" },
    { category: "Threads", text: "This is exactly the kind of content I come here for" },
    { category: "Threads", text: "I've had the same experience and it's nice to know I'm not the only one" },
    { category: "Threads", text: "You just described something a lot of people feel but rarely talk about" },
    { category: "Threads", text: "Hope things start moving in the right direction for you because you deserve a break" },
    { category: "Threads", text: "That must have taken a lot of patience and persistence to get through" },
    { category: "Threads", text: "The amount of work behind this really shows" },
    { category: "Threads", text: "You can tell this came from real experience rather than theory" },
    { category: "Threads", text: "This honestly made me look at the topic from a different angle" },
    { category: "Threads", text: "I wasn't expecting to agree this much but you're absolutely right" },
    { category: "Threads", text: "It's refreshing to read something that actually feels genuine" },


    // =========================
    // INSTAGRAM
    // =========================

    // Praise
    { category: "Instagram", text: "This looks amazing" },
    { category: "Instagram", text: "Love everything about this" },
    { category: "Instagram", text: "You have such a great eye for detail" },
    { category: "Instagram", text: "This turned out so well" },
    { category: "Instagram", text: "Really beautiful work" },
    { category: "Instagram", text: "Every part of this looks so thoughtful" },
    { category: "Instagram", text: "I could look at this for a while" },
    { category: "Instagram", text: "This is easily one of my favorites" },

    // Agree
    { category: "Instagram", text: "I totally agree" },
    { category: "Instagram", text: "That's exactly what I was thinking" },
    { category: "Instagram", text: "Couldn't have said it better" },
    { category: "Instagram", text: "Makes so much sense" },
    { category: "Instagram", text: "I'm completely with you" },
    { category: "Instagram", text: "I feel exactly the same" },
    { category: "Instagram", text: "This is so true" },
    { category: "Instagram", text: "You've got a point here" },

    // Sympathy
    { category: "Instagram", text: "Sorry to hear that" },
    { category: "Instagram", text: "Hope everything gets better soon" },
    { category: "Instagram", text: "Sending you lots of support" },
    { category: "Instagram", text: "Take care of yourself" },
    { category: "Instagram", text: "That sounds really tough" },
    { category: "Instagram", text: "Really hope things turn around for you" },

    // Admiration
    { category: "Instagram", text: "This is incredible" },
    { category: "Instagram", text: "I'm genuinely impressed" },
    { category: "Instagram", text: "You absolutely nailed this" },
    { category: "Instagram", text: "Such an inspiring result" },
    { category: "Instagram", text: "You should be really proud of this" },
    { category: "Instagram", text: "Everything about this feels so well done" },

    //Extra
    { category: "Instagram", text: "Everything about this feels thoughtful and really well put together" },
    { category: "Instagram", text: "You have a great eye for details and it really shows here" },    
    { category: "Instagram", text: "This feels effortless even though I know it probably wasn't" },    
    { category: "Instagram", text: "I kept coming back to this because there's so much to notice" },   
    { category: "Instagram", text: "This is such a clean and beautiful piece of work" },   
    { category: "Instagram", text: "I completely agree with what you wrote and couldn't have said it better myself" },   
    { category: "Instagram", text: "It's nice to see someone say this so honestly" },  
    { category: "Instagram", text: "I've been thinking about this a lot lately and you summed it up perfectly" },   
    { category: "Instagram", text: "Really hope things get easier for you because that sounds exhausting" },   
    { category: "Instagram", text: "Sorry you had to go through something like that and thanks for sharing it" },  
    { category: "Instagram", text: "This honestly deserves a lot more attention" },  
    { category: "Instagram", text: "You should be really proud of how this turned out because it looks fantastic" },  
    { category: "Instagram", text: "I can only imagine how much work went into creating this" },  
    { category: "Instagram", text: "This immediately caught my attention while scrolling" }, 
    { category: "Instagram", text: "This has such a natural feel to it and that's what makes it stand out" },


    // =========================
    // LINKEDIN
    // =========================

    // Praise
    { category: "LinkedIn", text: "Excellent work" },
    { category: "LinkedIn", text: "Really enjoyed reading your thoughts" },
    { category: "LinkedIn", text: "Thanks for sharing such a thoughtful perspective" },
    { category: "LinkedIn", text: "Very well explained" },
    { category: "LinkedIn", text: "This is a valuable insight" },
    { category: "LinkedIn", text: "You make a very strong case here" },
    { category: "LinkedIn", text: "This is a great reminder for all of us" },
    { category: "LinkedIn", text: "I appreciate the way you approached this topic" },

    // Agree
    { category: "LinkedIn", text: "I completely agree with this" },
    { category: "LinkedIn", text: "This aligns with my experience as well" },
    { category: "LinkedIn", text: "I've seen the same thing in my work" },
    { category: "LinkedIn", text: "Couldn't agree more" },
    { category: "LinkedIn", text: "This really resonates with me" },
    { category: "LinkedIn", text: "That's been my experience too" },
    { category: "LinkedIn", text: "I share the same perspective" },
    { category: "LinkedIn", text: "Very relatable from my experience" },

    // Sympathy
    { category: "LinkedIn", text: "Sorry to hear you're going through this" },
    { category: "LinkedIn", text: "Wishing you all the best moving forward" },
    { category: "LinkedIn", text: "Hope things improve soon" },
    { category: "LinkedIn", text: "That must have been a difficult experience" },
    { category: "LinkedIn", text: "Thanks for being open about this" },
    { category: "LinkedIn", text: "I hope the next chapter brings better opportunities" },

    // Admiration
    { category: "LinkedIn", text: "Really impressive achievement" },
    { category: "LinkedIn", text: "Congratulations on this milestone" },
    { category: "LinkedIn", text: "Outstanding work" },
    { category: "LinkedIn", text: "This is an impressive result" },
    { category: "LinkedIn", text: "You've built something truly valuable" },
    { category: "LinkedIn", text: "It's inspiring to see this level of execution" },

    //Extra
    { category: "LinkedIn", text: "Thank you for sharing such a practical perspective based on real experience" },
{ category: "LinkedIn", text: "This is one of the most useful posts I've read on this topic recently" },
{ category: "LinkedIn", text: "I appreciate that you focused on practical lessons instead of just theory" },
{ category: "LinkedIn", text: "This is a great reminder that simple ideas are often the most valuable" },
{ category: "LinkedIn", text: "You explained a complex topic in a very clear and approachable way" },
{ category: "LinkedIn", text: "This aligns almost perfectly with what I've seen across different teams" },
{ category: "LinkedIn", text: "I completely agree because we've experienced something very similar" },
{ category: "LinkedIn", text: "It's always interesting when someone puts real experience behind their opinion" },
{ category: "LinkedIn", text: "Thank you for being open about both the successes and the challenges" },
{ category: "LinkedIn", text: "Wishing you success with whatever comes next because this is clearly not the end of the story" },
{ category: "LinkedIn", text: "You should be proud of what you've accomplished because results like this don't happen by chance" },
{ category: "LinkedIn", text: "The consistency and effort behind this are easy to notice" },
{ category: "LinkedIn", text: "This is a great example of turning experience into something useful for others" },
{ category: "LinkedIn", text: "Posts like this are exactly why I enjoy spending time on LinkedIn" },
{ category: "LinkedIn", text: "I learned something new from this and that's always a good sign of a quality post" },

  ],
};