package com.execspec.generated;

import com.execspec.runtime.*;

public final class Main {
    public static void main(String[] args) throws Exception {
        BillingEngine engine = new BillingEngine();
        BillingExecSpecDispatcher dispatcher = new BillingExecSpecDispatcher(engine);
        Host.run(dispatcher);
    }
}
