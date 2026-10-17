package com.execspec.generated;
import com.execspec.runtime.*;

public final class Main {
    public static void main(String[] args) throws Exception {
        Host.run(new OrdersExecSpecDispatcher(new OrderStore()));
    }
}
